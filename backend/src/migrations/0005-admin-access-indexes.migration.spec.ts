// SPEC-002 (#2) / AR-29: 0005-admin-access-indexes against a recording fake of the driver (TS-04: the
// expectations are the exact index specs). That they equal the schemas' is
// admin-access/schemas/admin-access-indexes.spec.ts (AR-09 keeps the schemas inside their module);
// the run against MongoDB is test/integration/admin-access-indexes-migration.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import {
  adminAccessIndexes,
  createAdminAccessIndexes,
} from './0005-admin-access-indexes.migration.js';

function fakeDb() {
  const createIndexes = vi.fn((indexes: mongo.IndexDescription[]) =>
    Promise.resolve(indexes.map((index) => index.name ?? Object.keys(index.key).join('_'))),
  );
  const collection = vi.fn().mockReturnValue({ createIndexes });
  return { db: { collection } as unknown as mongo.Db, collection, createIndexes };
}

describe('createAdminAccessIndexes', () => {
  it('creates the one-open-grant-per-request index and the read indexes', async () => {
    const { db, collection, createIndexes } = fakeDb();

    await expect(createAdminAccessIndexes(db)).resolves.toEqual({
      supportAccessGrants: ['one_open_grant_per_request', 'adminUserId_openedAt'],
      adminAccessLogs: ['adminUserId_at', 'owner.id_at'],
    });

    expect(collection.mock.calls).toEqual([['supportAccessGrants'], ['adminAccessLogs']]);
    expect(createIndexes).toHaveBeenNthCalledWith(1, [
      {
        key: { supportRequestId: 1 },
        name: 'one_open_grant_per_request',
        unique: true,
        partialFilterExpression: { status: 'open' },
      },
      { key: { adminUserId: 1, openedAt: -1 } },
    ]);
    expect(createIndexes).toHaveBeenNthCalledWith(2, [
      { key: { adminUserId: 1, at: -1 } },
      { key: { 'owner.id': 1, at: -1 } },
    ]);
  });

  it('fails the run when the driver refuses an index (the deploy stops, DV-34)', async () => {
    const { db, createIndexes } = fakeDb();
    createIndexes.mockRejectedValueOnce(new Error('IndexOptionsConflict'));
    await expect(createAdminAccessIndexes(db)).rejects.toThrow('IndexOptionsConflict');
  });
});

describe('0005-admin-access-indexes', () => {
  it('has the id its file name gives and creates the indexes', async () => {
    const { db, createIndexes } = fakeDb();

    expect(adminAccessIndexes.id).toBe('0005-admin-access-indexes');
    await adminAccessIndexes.up(db);

    expect(createIndexes).toHaveBeenCalledTimes(2);
  });
});
