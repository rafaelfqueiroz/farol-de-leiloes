import { Inject, Injectable } from '@nestjs/common';
import businessConfig, { type BusinessConfig } from '../../config/business.config.js';
import type { ChangeDraft } from '../domain/change-types.js';
import type { DetailPage } from '../domain/detail-data.js';
import {
  documentReplacedEntry,
  type DocumentKind,
  isNewVersion,
  shouldFetchDocument,
  type VersionFacts,
} from '../domain/document-versions.js';
import type { AuctionFile, StoredDocumentVersion } from '../schemas/auction.schema.js';
import { type CopyRejection, type FetchFile, FileCopier } from './file-copier.js';
import type { StoredForCollection } from './enrichment.repository.js';

/** A stored version compared with Caixa's file and found the same (BR-004-30). */
export interface VersionCheck {
  kind: DocumentKind;
  contentHash: string;
  publishedAt: Date | null;
}

/** What the copies of one property gave (BR-004-22, BR-004-30). */
export interface PropertyCopies {
  /** The gallery as kept, in page order; undefined = nothing to change (none stated, or none kept). */
  photos?: AuctionFile[];
  /** The current edital / matrícula, when a NEW version was stored. */
  edital?: AuctionFile;
  matricula?: AuctionFile;
  newVersions: StoredDocumentVersion[];
  checked: VersionCheck[];
  /** BR-004-30: the replacement entries (never for a first copy). */
  entries: ChangeDraft[];
  /** Why files were not kept, by code: for the log (SC-15), never changes the property's outcome. */
  rejections: { kind: 'PHOTO' | DocumentKind; reason: CopyRejection }[];
}

/**
 * SPEC-004 BR-004-22, BR-004-30: what to copy for one property after its page was read, and what
 * the copies mean for its versions. Photos Caixa still lists at an address already stored are not
 * fetched again; the edital and the matrícula are fetched when `shouldFetchDocument` says so (none
 * stored, another address or publication date, or not compared for 30 days). A block propagates
 * (it stops the pass); any other failure of one file only skips that file.
 */
@Injectable()
export class PropertyCopier {
  constructor(
    private readonly copier: FileCopier,
    @Inject(businessConfig.KEY) private readonly business: BusinessConfig,
  ) {}

  async plan(
    stored: StoredForCollection,
    page: DetailPage,
    fetchFile: FetchFile,
    now: Date,
  ): Promise<PropertyCopies> {
    const result: PropertyCopies = { newVersions: [], checked: [], entries: [], rejections: [] };
    await this.copyPhotos(stored, page, fetchFile, now, result);
    await this.copyDocument('EDITAL', stored, page, fetchFile, now, result);
    await this.copyDocument('MATRICULA', stored, page, fetchFile, now, result);
    return result;
  }

  private async copyPhotos(
    stored: StoredForCollection,
    page: DetailPage,
    fetchFile: FetchFile,
    now: Date,
    result: PropertyCopies,
  ): Promise<void> {
    const wanted = page.photoUrls.slice(0, this.business.enrichment.maxPhotos);
    const kept: AuctionFile[] = [];
    for (const url of wanted) {
      const already = stored.photos.find(
        (photo) => photo.originalUrl === url && photo.storageKey !== undefined,
      );
      if (already !== undefined) {
        kept.push(already);
        continue;
      }
      const copy = await this.copier.copy('PHOTO', stored.code, url, fetchFile, now);
      if (copy.ok) kept.push(copy.file);
      else result.rejections.push({ kind: 'PHOTO', reason: copy.reason });
    }
    // Nothing kept (none stated, or every copy failed): the stored gallery stays as it is.
    if (kept.length > 0) result.photos = kept;
  }

  private async copyDocument(
    kind: DocumentKind,
    stored: StoredForCollection,
    page: DetailPage,
    fetchFile: FetchFile,
    now: Date,
    result: PropertyCopies,
  ): Promise<void> {
    const url = kind === 'EDITAL' ? page.editalUrl : page.matriculaUrl;
    const publishedAt = kind === 'EDITAL' ? page.editalPublishedAt : null;
    const current = currentVersion(stored.documentVersions, kind);
    const facts: VersionFacts | null =
      current === null
        ? null
        : {
            sourceUrl: current.sourceUrl,
            contentHash: current.contentHash,
            checkedAt: current.checkedAt,
            publishedAt: current.publishedAt,
          };
    if (url === null || !shouldFetchDocument(facts, { url, publishedAt }, now)) return;

    const copy = await this.copier.copy(kind, stored.code, url, fetchFile, now);
    if (!copy.ok) {
      result.rejections.push({ kind, reason: copy.reason });
      return;
    }
    const fetched = { sourceUrl: copy.file.originalUrl, contentHash: copy.contentHash };
    if (!isNewVersion(facts, fetched)) {
      result.checked.push({ kind, contentHash: copy.contentHash, publishedAt });
      return;
    }
    result.newVersions.push({
      kind,
      file: copy.file,
      sourceUrl: fetched.sourceUrl,
      contentHash: fetched.contentHash,
      retrievedAt: now,
      checkedAt: now,
      publishedAt,
    });
    if (kind === 'EDITAL') result.edital = copy.file;
    else result.matricula = copy.file;
    const entry = documentReplacedEntry(stored.code, kind, facts, fetched);
    if (entry !== null) result.entries.push(entry);
  }
}

/** The newest stored version of a kind (the list is oldest first), or null. */
function currentVersion(
  versions: readonly StoredDocumentVersion[],
  kind: DocumentKind,
): StoredDocumentVersion | null {
  for (let index = versions.length - 1; index >= 0; index--) {
    const version = versions[index];
    if (version?.kind === kind) return version;
  }
  return null;
}
