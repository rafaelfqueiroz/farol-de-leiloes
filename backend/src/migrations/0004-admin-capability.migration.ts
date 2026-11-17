// SPEC-002 (#2) DL-002-03 / BR-002-23, AR-28/AR-29: the admin capability moved out of the plan tier
// into its own flag.
//
//   users   isAdmin  → true  where role is 'admin' and the flag is not already true
//   users   isAdmin  → false where the flag is absent
//
// Expand/contract: `role` stays as it is (the plan tier, SPEC-012 contracts it), and from this
// release `role: 'admin'` grants nothing: not admin endpoints (AdminGuard reads `isAdmin`), not a
// paid feature. A deploy that ran this migration first keeps every existing admin an admin. A user
// without the flag is read as not admin anyway (JwtStrategy), so the second step is for queries and
// tidiness, not correctness.
//
// Idempotent (AR-29): both filters select only documents still in the old shape, so a second run
// changes nothing. The collection is named here, not reached through the schema (migration.ts).
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

const COLLECTION = 'users';

export interface AdminCapabilityCounts {
  adminsFlagged: number;
  flagBackfilled: number;
}

export async function copyAdminRoleToFlag(db: mongo.Db): Promise<AdminCapabilityCounts> {
  const users = db.collection(COLLECTION);

  const admins = await users.updateMany(
    { role: 'admin', isAdmin: { $ne: true } },
    { $set: { isAdmin: true } },
  );
  const others = await users.updateMany(
    { isAdmin: { $exists: false } },
    { $set: { isAdmin: false } },
  );

  return { adminsFlagged: admins.modifiedCount, flagBackfilled: others.modifiedCount };
}

export const adminCapability: Migration = {
  id: '0004-admin-capability',
  description: "users: isAdmin set where role is 'admin', false where absent (SPEC-002)",
  async up(db) {
    const counts = await copyAdminRoleToFlag(db);
    // Counts only: no document content reaches the log (SC-15).
    new Logger('Migrations').log(`0004-admin-capability ${JSON.stringify(counts)}`);
  },
};
