// SPEC-001 (#1) / AR-29: 0003-account-tokens against a recording fake of the collection (TS-04:
// the expectations are the exact filters). The run against MongoDB is
// test/integration/account-tokens-migration.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import {
  LEGACY_TOKEN_FIELDS,
  accountTokens,
  moveTokensOutOfUsers,
} from './0003-account-tokens.migration.js';

function fakeDb(modified: number[]) {
  const updateMany = vi.fn();
  for (const count of modified) updateMany.mockResolvedValueOnce({ modifiedCount: count });
  const collection = vi.fn().mockReturnValue({ updateMany });
  return { db: { collection } as unknown as mongo.Db, collection, updateMany };
}

describe('moveTokensOutOfUsers', () => {
  it('unsets the four legacy fields where any exists, then backfills a missing status', async () => {
    const { db, collection, updateMany } = fakeDb([7, 4]);

    await expect(moveTokensOutOfUsers(db)).resolves.toEqual({
      legacyTokensRemoved: 7,
      statusBackfilled: 4,
    });

    expect(collection).toHaveBeenCalledWith('users');
    expect(LEGACY_TOKEN_FIELDS).toEqual([
      'resetPasswordToken',
      'resetPasswordExpires',
      'emailVerificationToken',
      'emailVerificationExpires',
    ]);
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      {
        $or: [
          { resetPasswordToken: { $exists: true } },
          { resetPasswordExpires: { $exists: true } },
          { emailVerificationToken: { $exists: true } },
          { emailVerificationExpires: { $exists: true } },
        ],
      },
      {
        $unset: {
          resetPasswordToken: '',
          resetPasswordExpires: '',
          emailVerificationToken: '',
          emailVerificationExpires: '',
        },
      },
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      { status: { $exists: false } },
      { $set: { status: 'active' } },
    );
  });
});

describe('0003-account-tokens', () => {
  it('has the id its file name gives and runs the move', async () => {
    const { db, updateMany } = fakeDb([0, 0]);

    expect(accountTokens.id).toBe('0003-account-tokens');
    await accountTokens.up(db);

    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
