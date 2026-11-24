// SPEC-009 (#9) BR-009-17, AR-29: 0013-account-status-events-indexes against a recording fake of the
// driver (TS-04: the expectation is the exact index spec). That it equals the schema's is
// admin-accounts/schemas/account-status-indexes.spec.ts; the run against MongoDB is
// test/integration/account-status-events-indexes-migration.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import {
  accountStatusEventsIndexes,
  createAccountStatusEventsIndexes,
} from './0013-account-status-events-indexes.migration.js';

function fakeDb() {
  const createIndexes = vi.fn((indexes: mongo.IndexDescription[]) =>
    Promise.resolve(indexes.map((index) => Object.keys(index.key).join('_'))),
  );
  const collection = vi.fn().mockReturnValue({ createIndexes });
  return { db: { collection } as unknown as mongo.Db, collection, createIndexes };
}

describe('createAccountStatusEventsIndexes', () => {
  it('creates the history index, account first and newest first', async () => {
    const { db, collection, createIndexes } = fakeDb();

    await expect(createAccountStatusEventsIndexes(db)).resolves.toEqual({
      accountStatusEvents: ['userId_at'],
    });

    expect(collection.mock.calls).toEqual([['accountStatusEvents']]);
    expect(createIndexes).toHaveBeenCalledWith([{ key: { userId: 1, at: -1 } }]);
  });

  it('fails the run when the driver refuses an index (the deploy stops, DV-34)', async () => {
    const { db, createIndexes } = fakeDb();
    createIndexes.mockRejectedValueOnce(new Error('IndexOptionsConflict'));

    await expect(createAccountStatusEventsIndexes(db)).rejects.toThrow('IndexOptionsConflict');
  });

  it('is a registered migration that logs index names only', async () => {
    const { db } = fakeDb();

    expect(accountStatusEventsIndexes.id).toBe('0013-account-status-events-indexes');
    await expect(accountStatusEventsIndexes.up(db)).resolves.toBeUndefined();
  });
});
