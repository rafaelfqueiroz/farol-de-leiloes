import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { resolveOnCaixaSite } from '../../common/caixa-site.js';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import businessConfig, { type BusinessConfig } from '../../config/business.config.js';
import { StorageService } from '../../storage/storage.service.js';
import {
  CaixaBlockedError,
  type CaixaFile,
  CaixaUnreachableError,
  CaixaUrlRefusedError,
} from '../caixa/caixa-access.js';
import { copyKey, isPrivateCopy, isSafePropertyCode } from '../domain/copy-keys.js';
import { type CopyKind, validateCaixaFile } from '../domain/file-validation.js';
import type { AuctionFile } from '../schemas/auction.schema.js';

/** Why a file was not kept: a stable code, never a message or a URL (SC-15). */
export type CopyRejection =
  | 'UNSAFE_CODE'
  | 'STORAGE_UNCONFIGURED'
  | 'PRIVATE_STORAGE_UNCONFIGURED'
  | 'OFF_SITE'
  | 'UNREACHABLE'
  | 'FILE_EMPTY'
  | 'FILE_TOO_LARGE'
  | 'FILE_WRONG_TYPE'
  | 'FILE_TYPE_MISMATCH'
  | 'STORE_FAILED';

export type CopyResult =
  { ok: true; file: AuctionFile; contentHash: string } | { ok: false; reason: CopyRejection };

/** How the pass fetches: through the gate, after the lease check, logged (see the pass). */
export type FetchFile = (url: string) => Promise<CaixaFile>;

/**
 * SPEC-004 BR-004-22, BR-004-30, DL-004-10: keeps our own copy of a file Caixa publishes (a gallery
 * photo, the edital, the matrícula), so the property page still has it after Caixa removes the
 * listing.
 *
 *  - The file comes through `CaixaAccess` (the pass hands in a `FetchFile` that is that port behind
 *    the rate gate), never from here: an off-site address is refused before any request, and the
 *    port itself stops on a redirect off the site (SC-24).
 *  - It is kept only if it passes `validateCaixaFile` (SC-13: allowlist, bytes, size cap).
 *  - The key carries a prefix of the content hash, so a new version never overwrites an old one.
 *  - A matrícula names people (SC-25): it is stored under `private/` in the private bucket and
 *    linked per request, and when R2_PRIVATE_BUCKET is not configured it is NOT copied at all (it
 *    stays unknown): it never falls back to the public bucket (SC-18).
 *
 * A block (`CaixaBlockedError`) is not caught here: it stops the whole pass (BR-004-20). Any other
 * failure of one file is a rejection code the caller logs; it never fails the property.
 */
@Injectable()
export class FileCopier {
  private readonly logger = new Logger(FileCopier.name);

  constructor(
    private readonly storage: StorageService,
    @Inject(businessConfig.KEY) private readonly business: BusinessConfig,
  ) {}

  /** Whether `kind` can be stored at all right now (checked before a request is spent on it). */
  unavailableReason(kind: CopyKind, code: string): CopyRejection | null {
    if (!isSafePropertyCode(code)) return 'UNSAFE_CODE';
    if (isPrivateCopy(kind)) {
      return this.storage.isPrivateStorageConfigured() ? null : 'PRIVATE_STORAGE_UNCONFIGURED';
    }
    return this.storage.isConfigured() ? null : 'STORAGE_UNCONFIGURED';
  }

  async copy(
    kind: CopyKind,
    code: string,
    sourceUrl: string,
    fetchFile: FetchFile,
    now: Date,
  ): Promise<CopyResult> {
    const unavailable = this.unavailableReason(kind, code);
    if (unavailable !== null) return { ok: false, reason: unavailable };
    // SC-24 / SC-19: the address comes from Caixa's page, which is untrusted.
    const source = resolveOnCaixaSite(sourceUrl);
    if (source === null || source.protocol !== 'https:') return { ok: false, reason: 'OFF_SITE' };

    let file: CaixaFile;
    try {
      file = await fetchFile(source.href);
    } catch (error) {
      if (error instanceof CaixaBlockedError) throw error;
      if (error instanceof CaixaUrlRefusedError) return { ok: false, reason: 'OFF_SITE' };
      if (error instanceof CaixaUnreachableError) return { ok: false, reason: 'UNREACHABLE' };
      throw error; // a lease lost, a programming error: not this file's problem
    }

    const { maxPhotoBytes, maxDocumentBytes } = this.business.enrichment;
    const verdict = validateCaixaFile(kind, file, { maxPhotoBytes, maxDocumentBytes });
    if (!verdict.ok) return { ok: false, reason: `FILE_${verdict.reason}` };

    const contentHash = createHash('sha256').update(file.body).digest('hex');
    const key = copyKey(kind, code, contentHash, verdict.extension);
    if (key === null) return { ok: false, reason: 'UNSAFE_CODE' };
    try {
      await this.storage.uploadBuffer(key, file.body, verdict.contentType);
    } catch (error) {
      // SC-15: the class, never the message (it can quote a key).
      this.logger.warn(`Could not store a copy: ${jobErrorCode(error)}`);
      return { ok: false, reason: 'STORE_FAILED' };
    }
    const stored: AuctionFile = {
      originalUrl: source.href,
      storageKey: key,
      mimeType: verdict.contentType,
      size: verdict.size,
      uploadedAt: now,
      contentHash,
    };
    // SC-18: a private copy gets no public URL, whatever the public base is.
    if (!isPrivateCopy(kind)) stored.publicUrl = this.storage.publicUrlFor(key);
    return { ok: true, file: stored, contentHash };
  }
}
