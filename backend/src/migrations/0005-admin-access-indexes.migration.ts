// SPEC-002 (#2) BR-002-24 / BR-002-27, AR-27 / AR-29: the indexes of the support access grants and
// the admin access log, built by the deploy's migration step (DV-34) instead of relying on
// Mongoose's autoIndex at boot:
//
//   supportAccessGrants  { supportRequestId: 1 } unique, partial on status 'open',
//                        named one_open_grant_per_request — the guarantee that concurrent opens of
//                        one support request end with ONE grant (SupportGrantService.open)
//                        { adminUserId: 1, openedAt: -1 } — SPEC-009's "my grants"
//   adminAccessLogs      { adminUserId: 1, at: -1 } and { 'owner.id': 1, at: -1 } — SPEC-009's and
//                        SPEC-010's reads of the log
//
// The specs are the ones the schemas declare (admin-access/schemas/admin-access-indexes.spec.ts
// fails on any drift), so autoIndex, where it still runs, finds them in place and changes nothing.
//
// Idempotent (AR-29): createIndexes with an index that already exists with the same keys and
// options is a no-op, so a second run changes nothing. It creates the collections when missing.
// The collections are named here, not reached through the schemas (migration.ts).
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

export const ADMIN_ACCESS_INDEXES: Readonly<Record<string, readonly mongo.IndexDescription[]>> = {
  supportAccessGrants: [
    {
      key: { supportRequestId: 1 },
      name: 'one_open_grant_per_request',
      unique: true,
      partialFilterExpression: { status: 'open' },
    },
    { key: { adminUserId: 1, openedAt: -1 } },
  ],
  adminAccessLogs: [{ key: { adminUserId: 1, at: -1 } }, { key: { 'owner.id': 1, at: -1 } }],
};

/** Creates every index above; answers the index names per collection. */
export async function createAdminAccessIndexes(db: mongo.Db): Promise<Record<string, string[]>> {
  const created: Record<string, string[]> = {};
  for (const [collection, indexes] of Object.entries(ADMIN_ACCESS_INDEXES)) {
    created[collection] = await db.collection(collection).createIndexes([...indexes]);
  }
  return created;
}

export const adminAccessIndexes: Migration = {
  id: '0005-admin-access-indexes',
  description:
    'supportAccessGrants: one_open_grant_per_request and admin index; adminAccessLogs: read indexes (SPEC-002)',
  async up(db) {
    const created = await createAdminAccessIndexes(db);
    // Index names only: no document content reaches the log (SC-15).
    new Logger('Migrations').log(`0005-admin-access-indexes ${JSON.stringify(created)}`);
  },
};
