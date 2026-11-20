// SPEC-010 BR-010-01, BR-010-03, BR-010-05: recording that an account accepted the current terms
// and privacy policy, and telling which documents it still has to accept. Exported for SPEC-011
// (the invitation's acceptance: `recordAcceptance(userId, versions, 'invitation')`).
import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock/clock.js';
import { DomainError } from '../common/errors/domain-error.js';
import { ConsentsRepository, type AcceptanceRecord } from './consents.repository.js';
import {
  type AcceptanceMethod,
  LEGAL_DOCUMENT_TYPES,
  type LegalDocumentRef,
  type LegalDocumentType,
  outdatedTypes,
  pendingAcceptances,
} from './domain/legal-versions.js';
import { LegalDocumentsService } from './legal-documents.service.js';

/** The versions an account accepts: one per document type. */
export type AcceptedVersions = Readonly<Record<LegalDocumentType, string>>;

/** The versions a request names; a type left out means "the current one". */
export type RequestedVersions = Readonly<Partial<Record<LegalDocumentType, string | undefined>>>;

@Injectable()
export class ConsentsService {
  constructor(
    private readonly consents: ConsentsRepository,
    private readonly legal: LegalDocumentsService,
    private readonly clock: Clock,
  ) {}

  /**
   * The versions a sign-up or an accept request is for: the current ones, when the request names
   * none, or exactly the ones it names when those are the current ones. Anything else is
   * TERMS_VERSION_OUTDATED (409, the context lists the current ones). Called BEFORE an account is
   * created, so a stale form creates nothing (BR-010-01).
   */
  resolveVersions(requested: RequestedVersions): AcceptedVersions {
    const current = this.legal.currentVersions();
    if (outdatedTypes(current, requested).length > 0) {
      throw new DomainError('TERMS_VERSION_OUTDATED', {
        documents: this.legal
          .currentRefs()
          .map((ref) => ({ type: ref.type, version: ref.version })),
      });
    }
    return current;
  }

  /**
   * Records that the account accepted these versions, by this method, now (BR-010-03). A version
   * already accepted is left as it is: a repeat, or two accepts at the same moment, end with one
   * row per document. The versions are those the person was shown (see `resolveVersions`), so a
   * version published between the check and this write is simply accepted as the older text.
   */
  async recordAcceptance(
    userId: string,
    versions: AcceptedVersions,
    method: AcceptanceMethod,
  ): Promise<void> {
    const acceptedAt = this.clock.now();
    const rows = LEGAL_DOCUMENT_TYPES.map((type) => {
      const document = this.legal.find(type, versions[type]);
      // An unknown or not-yet-published version cannot have been shown to anybody.
      if (document === null) {
        throw new DomainError('TERMS_VERSION_OUTDATED', {
          documents: this.legal
            .currentRefs()
            .map((ref) => ({ type: ref.type, version: ref.version })),
        });
      }
      return {
        userId,
        documentType: type,
        version: document.version,
        contentHash: document.contentHash,
        acceptedAt,
        method,
      };
    });
    await Promise.all(rows.map((row) => this.consents.insert(row)));
  }

  /** POST /privacy/accept: a re-acceptance of the current versions (BR-010-05). */
  async accept(userId: string, requested: AcceptedVersions): Promise<AcceptanceRecord[]> {
    const versions = this.resolveVersions(requested);
    await this.recordAcceptance(userId, versions, 'reacceptance');
    return this.consents.listForUser(userId);
  }

  /** The account's own acceptances, newest first (BR-010-04). */
  listFor(userId: string): Promise<AcceptanceRecord[]> {
    return this.consents.listForUser(userId);
  }

  /**
   * The current documents the account has not accepted (BR-010-05): empty when it is up to date.
   * One indexed count per call; the second query runs only for an account that is behind. Never
   * cached across requests (AR-13): it is read on every request that needs it.
   */
  async pendingFor(userId: string): Promise<LegalDocumentRef[]> {
    const current = this.legal.currentRefs();
    if ((await this.consents.countAccepted(userId, current)) === current.length) return [];
    return pendingAcceptances(current, await this.consents.findAccepted(userId, current));
  }
}
