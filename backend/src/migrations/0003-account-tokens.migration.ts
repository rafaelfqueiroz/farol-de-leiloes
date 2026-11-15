// SPEC-001 (#1), AR-28/AR-29: the one-time link tokens moved out of the user document into the
// `accountTokens` collection (hashed, single use, TTL), and accounts gained a `status`.
//
//   users   resetPasswordToken, resetPasswordExpires,
//           emailVerificationToken, emailVerificationExpires   → removed
//   users   status                                              → 'active' where absent
//
// Expand/contract: the new code never reads the four legacy fields (it neither writes nor selects
// them), so removing them here is safe in the same release. An outstanding link simply stops
// working and the person asks for a new one; rolling back loses nothing but those links. A user
// without `status` is read as active anyway (BR-001-16), so the backfill is for queries and
// tidiness, not correctness.
//
// Idempotent (AR-29): `$unset` of an absent field and `status` only where it does not exist both
// change nothing on a second run. The collection is named here, not reached through the schema
// (migration.ts).
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

const COLLECTION = 'users';

export const LEGACY_TOKEN_FIELDS = [
  'resetPasswordToken',
  'resetPasswordExpires',
  'emailVerificationToken',
  'emailVerificationExpires',
] as const;

export interface AccountTokensCounts {
  legacyTokensRemoved: number;
  statusBackfilled: number;
}

export async function moveTokensOutOfUsers(db: mongo.Db): Promise<AccountTokensCounts> {
  const users = db.collection(COLLECTION);

  const unset = await users.updateMany(
    { $or: LEGACY_TOKEN_FIELDS.map((field) => ({ [field]: { $exists: true } })) },
    { $unset: Object.fromEntries(LEGACY_TOKEN_FIELDS.map((field) => [field, ''])) },
  );
  const status = await users.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'active' } },
  );

  return { legacyTokensRemoved: unset.modifiedCount, statusBackfilled: status.modifiedCount };
}

export const accountTokens: Migration = {
  id: '0003-account-tokens',
  description:
    'users: legacy reset/verification token fields removed, status backfilled to active (SPEC-001)',
  async up(db) {
    const counts = await moveTokensOutOfUsers(db);
    // Counts only: no document content reaches the log (SC-15).
    new Logger('Migrations').log(`0003-account-tokens ${JSON.stringify(counts)}`);
  },
};
