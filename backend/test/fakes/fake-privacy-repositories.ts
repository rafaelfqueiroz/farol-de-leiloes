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

export class FakeConsentsRepository implements Port<ConsentsRepository> {
  readonly rows: NewAcceptance[] = [];
  /** How many queries the terms guard's path made (count + find), for the "one query" claim. */
  counts = 0;
  finds = 0;

  async insert(entry: NewAcceptance): Promise<boolean> {
    const exists = this.rows.some(
      (row) =>
        row.userId === entry.userId &&
        row.documentType === entry.documentType &&
        row.version === entry.version,
    );
    if (!exists) this.rows.push(entry);
    return !exists;
  }

  async countAccepted(userId: string, refs: readonly LegalDocumentRef[]): Promise<number> {
    this.counts += 1;
    return (await this.findAcceptedQuietly(userId, refs)).length;
  }

  async findAccepted(
    userId: string,
    refs: readonly LegalDocumentRef[],
  ): Promise<LegalDocumentRef[]> {
    this.finds += 1;
    return this.findAcceptedQuietly(userId, refs);
  }

  private findAcceptedQuietly(userId: string, refs: readonly LegalDocumentRef[]) {
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            row.userId === userId &&
            refs.some((ref) => ref.type === row.documentType && ref.version === row.version),
        )
        .map((row) => ({ type: row.documentType, version: row.version })),
    );
  }

  async listForUser(userId: string): Promise<AcceptanceRecord[]> {
    return this.rows
      .filter((row) => row.userId === userId)
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

  async insert(entry: NewWhatsappAnswer): Promise<void> {
    this.rows.push(entry);
  }

  async latest(userId: string): Promise<WhatsappAnswer | null> {
    const own = this.rows.filter((row) => row.userId === userId);
    const last = own[own.length - 1];
    return last === undefined
      ? null
      : { action: last.action, method: last.method, textVersion: last.textVersion, at: last.at };
  }
}
