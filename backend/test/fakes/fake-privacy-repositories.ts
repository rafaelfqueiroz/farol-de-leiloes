// TS-03: hand-written in-memory fakes of the privacy repositories (SPEC-010). They implement the
// real public surface (a mapped type drops the private model), so a signature change breaks them at
// compile time. The MongoDB behaviour itself (the unique index deciding concurrent accepts, the
// insert-only middleware) is proven against a real database in test/integration/privacy.spec.ts.
import type {
  AcceptanceRecord,
  ConsentsRepository,
  NewAcceptance,
} from '../../src/privacy/consents.repository.js';
import type { LegalDocumentRef } from '../../src/privacy/domain/legal-versions.js';
import type {
  NewWhatsappAnswer,
  WhatsappAnswer,
  WhatsappConsentRepository,
} from '../../src/privacy/whatsapp-consent.repository.js';

type Port<T> = { [K in keyof T]: T[K] };

const sameGeneration = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

export class FakeConsentsRepository implements Port<ConsentsRepository> {
  readonly rows: NewAcceptance[] = [];
  /** How many queries the terms guard's path made, for the "one query" claim. */
  finds = 0;
  /** Makes every insert fail, as an unreachable database would (the sign-up rollback specs). */
  failInsertsWith: Error | undefined;
  /**
   * Runs at the start of every insert, before it fails or succeeds: a spec makes it wait on a gate
   * to hold the sign-up inside its consent write while another request runs (SPEC-010 BR-010-01).
   */
  beforeInsert: (() => Promise<void>) | undefined;

  /** Like the unique index {userId, consentResetAt, documentType, version}. */
  async insert(entry: NewAcceptance): Promise<boolean> {
    await this.beforeInsert?.();
    if (this.failInsertsWith) throw this.failInsertsWith;
    const exists = this.rows.some(
      (row) =>
        row.userId === entry.userId &&
        sameGeneration(row.consentResetAt, entry.consentResetAt) &&
        row.documentType === entry.documentType &&
        row.version === entry.version,
    );
    if (!exists) this.rows.push(entry);
    return !exists;
  }

  /** Inserts a row with no uniqueness check, as a database without the unique index would. */
  insertUnchecked(entry: NewAcceptance): void {
    this.rows.push(entry);
  }

  async findAccepted(
    userId: string,
    consentResetAt: Date | null,
    refs: readonly LegalDocumentRef[],
  ): Promise<LegalDocumentRef[]> {
    this.finds += 1;
    return this.rows
      .filter(
        (row) =>
          row.userId === userId &&
          sameGeneration(row.consentResetAt, consentResetAt) &&
          refs.some((ref) => ref.type === row.documentType && ref.version === row.version),
      )
      .map((row) => ({ type: row.documentType, version: row.version }));
  }

  async listForUser(userId: string, consentResetAt: Date | null): Promise<AcceptanceRecord[]> {
    return this.rows
      .filter((row) => row.userId === userId && sameGeneration(row.consentResetAt, consentResetAt))
      .map(({ documentType, version, acceptedAt, method }) => ({
        documentType,
        version,
        acceptedAt,
        method,
      }))
      .reverse();
  }
}

export class FakeWhatsappConsentRepository implements Port<WhatsappConsentRepository> {
  readonly rows: NewWhatsappAnswer[] = [];

  /** Makes every insert fail, as an unreachable database would. */
  failInsertsWith: Error | undefined;

  async insert(entry: NewWhatsappAnswer): Promise<void> {
    if (this.failInsertsWith) throw this.failInsertsWith;
    this.rows.push(entry);
  }

  async latest(userId: string, consentResetAt: Date | null): Promise<WhatsappAnswer | null> {
    const own = this.rows.filter(
      (row) => row.userId === userId && sameGeneration(row.consentResetAt, consentResetAt),
    );
    const last = own[own.length - 1];
    return last === undefined
      ? null
      : { action: last.action, method: last.method, textVersion: last.textVersion, at: last.at };
  }
}
