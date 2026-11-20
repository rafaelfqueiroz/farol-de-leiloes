// SPEC-010 (#10) BR-010-03, BR-010-27, AR-27 / AR-29: the indexes of the acceptance and consent
// records, built by the deploy's migration step (DV-34) instead of relying on Mongoose's autoIndex:
//
//   consents          { userId: 1, consentResetAt: 1, documentType: 1, version: 1 } unique, named
//                     one_acceptance_per_version — one acceptance per account, consent generation
//                     (consentResetAt: a Google takeover starts a new one, DL-001-02), document and
//                     version, whatever races (a repeat or twenty accepts at once end with one row); it also
//                     serves the terms guard's query on every request and the account's own list
//   whatsappConsents  { userId: 1, consentResetAt: 1, at: -1 } — the latest answer of an account
//                     under its current consent generation
//
// The specs are the ones the schemas declare (privacy/schemas/consent-indexes.spec.ts fails on any
// drift), so autoIndex, where it still runs, finds them in place and changes nothing.
//
// Idempotent (AR-29): createIndexes with an index that already exists with the same keys and
// options is a no-op. It creates the collections when missing. The collections are named here, not
// reached through the schemas (migration.ts).
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

export const CONSENT_INDEXES: Readonly<Record<string, readonly mongo.IndexDescription[]>> = {
  consents: [
    {
      key: { userId: 1, consentResetAt: 1, documentType: 1, version: 1 },
      name: 'one_acceptance_per_version',
      unique: true,
    },
  ],
  whatsappConsents: [{ key: { userId: 1, consentResetAt: 1, at: -1 } }],
};

/** Creates every index above; answers the index names per collection. */
export async function createConsentIndexes(db: mongo.Db): Promise<Record<string, string[]>> {
  const created: Record<string, string[]> = {};
  for (const [collection, indexes] of Object.entries(CONSENT_INDEXES)) {
    created[collection] = await db.collection(collection).createIndexes([...indexes]);
  }
  return created;
}

export const consentIndexes: Migration = {
  id: '0008-consent-indexes',
  description:
    'consents: unique acceptance per account, document and version; whatsappConsents: latest answer per account (SPEC-010)',
  async up(db) {
    const created = await createConsentIndexes(db);
    // Index names only: no document content reaches the log (SC-15).
    new Logger('Migrations').log(`0008-consent-indexes ${JSON.stringify(created)}`);
  },
};
