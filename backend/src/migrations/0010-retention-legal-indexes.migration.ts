// SPEC-010 (#10) BR-010-21, BR-010-26, AR-27 / AR-29: the indexes of the retention and legal-validation
// part, built by the deploy's migration step (DV-34) instead of relying on Mongoose's autoIndex:
//
//   retentionDeletions { journeyId: 1 } unique, named one_deletion_per_journey: one log row per journey,
//                      whatever races (a run repairing a crash, two replicas) (BR-010-21)
//   legalValidations   { scope: 1, validatedAt: -1 }: the gate and the checklist read the newest records
//                      of one scope (BR-010-25, BR-010-26)
//
// The specs are the ones the schemas declare (privacy/schemas/retention-legal-indexes.spec.ts fails on
// any drift), so autoIndex, where it still runs, finds them in place and changes nothing.
//
// Idempotent (AR-29): createIndexes with an index that already exists with the same keys and options is
// a no-op. It creates the collections when missing. The collections are named here, not reached
// through the schemas (migration.ts). No document is read or written.
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

export const RETENTION_LEGAL_INDEXES: Readonly<Record<string, readonly mongo.IndexDescription[]>> =
  {
    retentionDeletions: [{ key: { journeyId: 1 }, name: 'one_deletion_per_journey', unique: true }],
    legalValidations: [{ key: { scope: 1, validatedAt: -1 } }],
  };

/** Creates every index above; answers the index names per collection. */
export async function createRetentionLegalIndexes(db: mongo.Db): Promise<Record<string, string[]>> {
  const created: Record<string, string[]> = {};
  for (const [collection, indexes] of Object.entries(RETENTION_LEGAL_INDEXES)) {
    created[collection] = await db.collection(collection).createIndexes([...indexes]);
  }
  return created;
}

export const retentionLegalIndexes: Migration = {
  id: '0010-retention-legal-indexes',
  description:
    'retentionDeletions: one log row per journey; legalValidations: the newest records of a scope (SPEC-010)',
  async up(db) {
    const created = await createRetentionLegalIndexes(db);
    // Index names only: no document content reaches the log (SC-15).
    new Logger('Migrations').log(`0010-retention-legal-indexes ${JSON.stringify(created)}`);
  },
};
