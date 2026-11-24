// SPEC-009 (#9) BR-009-16, BR-009-17, AR-27 / AR-29: the index of the account status history, built by
// the deploy's migration step (DV-34) instead of relying on Mongoose's autoIndex:
//
//   accountStatusEvents { userId: 1, at: -1 }: "the history of this account, newest first", read on
//                       every account record an admin opens (BR-009-13, BR-009-17)
//
// The spec is the one the schema declares (admin-accounts/schemas/account-status-indexes.spec.ts fails
// on any drift), so autoIndex, where it still runs, finds it in place and changes nothing.
//
// Idempotent (AR-29): createIndexes with an index that already exists with the same keys and options
// is a no-op. It creates the collection when missing. The collection is named here, not reached
// through the schema (migration.ts). No document is read or written.
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

export const ACCOUNT_STATUS_EVENTS_INDEXES: readonly mongo.IndexDescription[] = [
  { key: { userId: 1, at: -1 } },
];

/** Creates every index above; answers the index names per collection. */
export async function createAccountStatusEventsIndexes(
  db: mongo.Db,
): Promise<Record<string, string[]>> {
  return {
    accountStatusEvents: await db
      .collection('accountStatusEvents')
      .createIndexes([...ACCOUNT_STATUS_EVENTS_INDEXES]),
  };
}

export const accountStatusEventsIndexes: Migration = {
  id: '0013-account-status-events-indexes',
  description: 'accountStatusEvents: the account history, newest first (SPEC-009)',
  async up(db) {
    const created = await createAccountStatusEventsIndexes(db);
    // Index names only: no document content reaches the log (SC-15).
    new Logger('Migrations').log(`0013-account-status-events-indexes ${JSON.stringify(created)}`);
  },
};
