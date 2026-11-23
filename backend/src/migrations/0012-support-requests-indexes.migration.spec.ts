// SPEC-009 (#9) BR-009-06, BR-009-07, AR-29: 0012-support-requests-indexes against a recording fake of
// the driver (TS-04: the expectations are the exact index specs). That they equal the schema's is
// support/schemas/support-indexes.spec.ts; the run against MongoDB is
// test/integration/support-requests-indexes-migration.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import {
  createSupportRequestsIndexes,
  supportRequestsIndexes,
} from './0012-support-requests-indexes.migration.js';

function fakeDb() {
  const createIndexes = vi.fn((indexes: mongo.IndexDescription[]) =>
    Promise.resolve(indexes.map((index) => Object.keys(index.key).join('_'))),
  );
  const collection = vi.fn().mockReturnValue({ createIndexes });
  return { db: { collection } as unknown as mongo.Db, collection, createIndexes };
}

describe('createSupportRequestsIndexes', () => {
  it('creates the unique protocol, the requester list, the status queue and the partial outbox scan', async () => {
    const { db, collection, createIndexes } = fakeDb();

    await expect(createSupportRequestsIndexes(db)).resolves.toEqual({
      supportRequests: ['protocol', 'userId_createdAt', 'status_createdAt', 'mailNextAttemptAt'],
    });

    expect(collection.mock.calls).toEqual([['supportRequests']]);
    expect(createIndexes).toHaveBeenCalledWith([
      { key: { protocol: 1 }, unique: true },
      { key: { userId: 1, createdAt: -1 } },
      { key: { status: 1, createdAt: -1 } },
      {
        key: { mailNextAttemptAt: 1 },
        partialFilterExpression: { mailNextAttemptAt: { $exists: true } },
      },
    ]);
  });

  it('fails the run when the driver refuses an index (the deploy stops, DV-34)', async () => {
    const { db, createIndexes } = fakeDb();
    createIndexes.mockRejectedValueOnce(new Error('IndexOptionsConflict'));

    await expect(createSupportRequestsIndexes(db)).rejects.toThrow('IndexOptionsConflict');
  });

  it('is a registered migration that logs index names only', async () => {
    const { db } = fakeDb();

    expect(supportRequestsIndexes.id).toBe('0012-support-requests-indexes');
    await expect(supportRequestsIndexes.up(db)).resolves.toBeUndefined();
  });
});
