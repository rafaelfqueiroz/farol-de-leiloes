// SPEC-010 (#10) BR-010-11, BR-010-15, BR-010-28, AR-27 / AR-29: the indexes of the data-subject-rights
// part, built by the deploy's migration step (DV-34) instead of relying on Mongoose's autoIndex:
//
//   dataExports     { userId: 1 } unique, partial on `live: true`, named one_live_export_per_user: one
//                   queued or ready export per account, whatever races (BR-010-11); the account's own
//                   list { userId, requestedAt: -1 }; the worker's queue { status, requestedAt } and the
//                   expiry job's scan { status, expiresAt }
//   actorPseudonyms { journeyId, userId } unique, partial on an existing account: one label per
//                   person and journey, any number of detached (userId null) rows (BR-010-28); one
//                   person per label in a journey { journeyId, pseudonym } unique; and { userId } for
//                   the detach at purge
//   users           { status: 1, closedAt: 1 }: the alert's count of closed accounts (BR-010-15);
//                   { status: 1, lastPurgeAttemptAt: 1, purgeAttempts: 1, closedAt: 1 }: the purge
//                   job's fair queue, never-attempted accounts first, then the least recently attempted,
//                   then the fewest attempts, then the oldest closure, so an account that keeps failing
//                   cannot starve a healthy one;
//                   { residueSweepDueAt: 1 } sparse: the residue sweep's scan, which only the accounts
//                   still waiting for their sweep carry
//
// The specs are the ones the schemas declare (privacy/schemas/rights-indexes.spec.ts fails on any
// drift), so autoIndex, where it still runs, finds them in place and changes nothing.
//
// Idempotent (AR-29): createIndexes with an index that already exists with the same keys and
// options is a no-op. It creates the collections when missing. The collections are named here, not
// reached through the schemas (migration.ts). No document is read or written.
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

export const PRIVACY_RIGHTS_INDEXES: Readonly<Record<string, readonly mongo.IndexDescription[]>> = {
  dataExports: [
    {
      key: { userId: 1 },
      name: 'one_live_export_per_user',
      unique: true,
      partialFilterExpression: { live: true },
    },
    { key: { userId: 1, requestedAt: -1 } },
    { key: { status: 1, requestedAt: 1 } },
    { key: { status: 1, expiresAt: 1 } },
  ],
  actorPseudonyms: [
    {
      key: { journeyId: 1, userId: 1 },
      name: 'one_pseudonym_per_person_and_journey',
      unique: true,
      partialFilterExpression: { userId: { $type: 'objectId' } },
    },
    {
      key: { journeyId: 1, pseudonym: 1 },
      name: 'one_person_per_pseudonym_in_journey',
      unique: true,
    },
    {
      key: { userId: 1 },
      name: 'pseudonyms_of_user',
      partialFilterExpression: { userId: { $type: 'objectId' } },
    },
  ],
  users: [
    { key: { status: 1, closedAt: 1 } },
    { key: { status: 1, lastPurgeAttemptAt: 1, purgeAttempts: 1, closedAt: 1 } },
    { key: { residueSweepDueAt: 1 }, sparse: true },
  ],
};

/** Creates every index above; answers the index names per collection. */
export async function createPrivacyRightsIndexes(db: mongo.Db): Promise<Record<string, string[]>> {
  const created: Record<string, string[]> = {};
  for (const [collection, indexes] of Object.entries(PRIVACY_RIGHTS_INDEXES)) {
    created[collection] = await db.collection(collection).createIndexes([...indexes]);
  }
  return created;
}

export const privacyRightsIndexes: Migration = {
  id: '0009-privacy-rights-indexes',
  description:
    'dataExports: one live export per account and the worker and expiry scans; actorPseudonyms: one label per person and journey; users: the purge queue, its fair order and the residue sweep scan (SPEC-010)',
  async up(db) {
    const created = await createPrivacyRightsIndexes(db);
    // Index names only: no document content reaches the log (SC-15).
    new Logger('Migrations').log(`0009-privacy-rights-indexes ${JSON.stringify(created)}`);
  },
};
