// SPEC-009 (#9) BR-009-06, BR-009-07, BR-009-09, AR-27 / AR-29: the indexes of the support requests,
// built by the deploy's migration step (DV-34) instead of relying on Mongoose's autoIndex:
//
//   supportRequests { protocol: 1 } unique: a protocol is unique across the platform whatever races
//                   (BR-009-06)
//   supportRequests { userId: 1, createdAt: -1 }: the requester's own list, newest first (BR-009-09)
//   supportRequests { status: 1, createdAt: -1 }: the admin's queue by status (BR-009-12)
//   supportRequests { mailNextAttemptAt: 1 } partial on the field existing: the outbox worker's scan
//                   of what is due (BR-009-07); only requests that still owe an email carry it
//
// The `counters` collection needs none: its `_id` is the key.
//
// The specs are the ones the schema declares (support/schemas/support-indexes.spec.ts fails on any
// drift), so autoIndex, where it still runs, finds them in place and changes nothing.
//
// Idempotent (AR-29): createIndexes with an index that already exists with the same keys and options
// is a no-op. It creates the collection when missing. The collection is named here, not reached
// through the schema (migration.ts). No document is read or written.
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

export const SUPPORT_REQUESTS_INDEXES: readonly mongo.IndexDescription[] = [
  { key: { protocol: 1 }, unique: true },
  { key: { userId: 1, createdAt: -1 } },
  { key: { status: 1, createdAt: -1 } },
  {
    key: { mailNextAttemptAt: 1 },
    partialFilterExpression: { mailNextAttemptAt: { $exists: true } },
  },
];

/** Creates every index above; answers the index names per collection. */
export async function createSupportRequestsIndexes(
  db: mongo.Db,
): Promise<Record<string, string[]>> {
  return {
    supportRequests: await db
      .collection('supportRequests')
      .createIndexes([...SUPPORT_REQUESTS_INDEXES]),
  };
}

export const supportRequestsIndexes: Migration = {
  id: '0012-support-requests-indexes',
  description:
    'supportRequests: unique protocol, the requester list, the status queue and the outbox scan (SPEC-009)',
  async up(db) {
    const created = await createSupportRequestsIndexes(db);
    // Index names only: no document content reaches the log (SC-15).
    new Logger('Migrations').log(`0012-support-requests-indexes ${JSON.stringify(created)}`);
  },
};
