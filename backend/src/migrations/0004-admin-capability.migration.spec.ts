// SPEC-002 (#2) / AR-29: 0004-admin-capability against a recording fake of the collection (TS-04:
// the expectations are the exact filters). The run against MongoDB is
// test/integration/admin-capability-migration.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import { adminCapability, copyAdminRoleToFlag } from './0004-admin-capability.migration.js';

function fakeDb(modified: number[]) {
  const updateMany = vi.fn();
  for (const count of modified) updateMany.mockResolvedValueOnce({ modifiedCount: count });
  const collection = vi.fn().mockReturnValue({ updateMany });
  return { db: { collection } as unknown as mongo.Db, collection, updateMany };
}

describe('copyAdminRoleToFlag', () => {
  it("flags the 'admin' role accounts not yet flagged, then backfills false where absent", async () => {
    const { db, collection, updateMany } = fakeDb([2, 9]);

    await expect(copyAdminRoleToFlag(db)).resolves.toEqual({
      adminsFlagged: 2,
      flagBackfilled: 9,
    });

    expect(collection).toHaveBeenCalledWith('users');
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      { role: 'admin', isAdmin: { $ne: true } },
      { $set: { isAdmin: true } },
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      { isAdmin: { $exists: false } },
      { $set: { isAdmin: false } },
    );
  });
});

describe('0004-admin-capability', () => {
  it('has the id its file name gives and runs the copy', async () => {
    const { db, updateMany } = fakeDb([0, 0]);

    expect(adminCapability.id).toBe('0004-admin-capability');
    await adminCapability.up(db);

    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
