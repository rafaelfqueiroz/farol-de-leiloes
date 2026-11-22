// SPEC-010 BR-010-02, BR-010-04, BR-010-05: the legal texts and which version of each is in force
// now. The registry is injected (legal/registry.ts in production), the time comes from the Clock
// (AR-24), and the selection itself is the pure domain/legal-versions.ts (AR-05).
import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../common/clock/clock.js';
import {
  compareVersions,
  currentVersion,
  isInEffect,
  LEGAL_DOCUMENT_TYPES,
  type LegalDocumentRef,
  type LegalDocumentType,
  VERSION_PATTERN,
} from './domain/legal-versions.js';
import type { PublishedLegalDocument } from './legal/legal-document.js';
import { LEGAL_DOCUMENTS } from './legal/registry.js';

/** One published version for the list of versions (BR-010-04). */
export interface LegalVersionListing {
  readonly document: PublishedLegalDocument;
  readonly current: boolean;
}

export type CurrentVersions = Readonly<Record<LegalDocumentType, string>>;

@Injectable()
export class LegalDocumentsService {
  constructor(
    @Inject(LEGAL_DOCUMENTS) private readonly documents: readonly PublishedLegalDocument[],
    private readonly clock: Clock,
  ) {
    // A malformed registry is a programming error found at boot, not by an account (AR-41).
    const seen = new Set<string>();
    for (const document of documents) {
      const key = `${document.type}@${document.version}`;
      if (!VERSION_PATTERN.test(document.version) || seen.has(key)) {
        throw new Error(`Invalid legal document registry: ${key}`);
      }
      seen.add(key);
    }
  }

  /** The version in force of each document; a type with none in force is a misconfiguration. */
  current(): Record<LegalDocumentType, PublishedLegalDocument> {
    const now = this.clock.now();
    const pick = (type: LegalDocumentType): PublishedLegalDocument => {
      const found = currentVersion(type, this.documents, now);
      if (found === null) throw new Error(`No ${type} version is in force (legal registry)`);
      return found;
    };
    return { terms: pick('terms'), privacy: pick('privacy') };
  }

  currentVersions(): CurrentVersions {
    const current = this.current();
    return { terms: current.terms.version, privacy: current.privacy.version };
  }

  /** The current versions as references, in catalogue order (what the guard and /auth/me list). */
  currentRefs(): LegalDocumentRef[] {
    const versions = this.currentVersions();
    return LEGAL_DOCUMENT_TYPES.map((type) => ({ type, version: versions[type] }));
  }

  /** A published version, or null when it does not exist or is not in force yet (BR-010-04). */
  find(type: LegalDocumentType, version: string): PublishedLegalDocument | null {
    const now = this.clock.now();
    const found = this.documents.find(
      (document) => document.type === type && document.version === version,
    );
    return found !== undefined && isInEffect(found, now) ? found : null;
  }

  /** Every version in force or past, by document type and newest first. */
  list(): LegalVersionListing[] {
    const now = this.clock.now();
    const current = this.current();
    return LEGAL_DOCUMENT_TYPES.flatMap((type) =>
      this.documents
        .filter((document) => document.type === type && isInEffect(document, now))
        .sort(
          (a, b) =>
            b.effectiveAt.getTime() - a.effectiveAt.getTime() ||
            compareVersions(b.version, a.version),
        )
        .map((document) => ({ document, current: document === current[type] })),
    );
  }
}
