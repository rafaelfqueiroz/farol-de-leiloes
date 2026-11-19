// SPEC-012 (#12) BR-012-07, BR-012-08, AR-15, AR-29: 0007-billing-indexes against a recording fake of
// the driver (TS-04: the expectations are the exact index specs). That they equal the schemas' is
// subscriptions/schemas/subscription-indexes.spec.ts and access/schemas/owner-counter-indexes.spec.ts;
// the run against MongoDB is test/integration/billing-indexes-migration.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import { billingIndexes, createBillingIndexes } from './0007-billing-indexes.migration.js';

function fakeDb() {
  const createIndexes = vi.fn((indexes: mongo.IndexDescription[]) =>
    Promise.resolve(indexes.map((index) => index.name ?? Object.keys(index.key).join('_'))),
  );
  const collection = vi.fn().mockReturnValue({ createIndexes });
  return { db: { collection } as unknown as mongo.Db, collection, createIndexes };
}

describe('createBillingIndexes', () => {
  it('creates the open-checkout guard, the reconcile and purge reads, and the unique counter', async () => {
    const { db, collection, createIndexes } = fakeDb();

    await expect(createBillingIndexes(db)).resolves.toEqual({
      subscriptions: ['one_open_checkout_per_key', 'status_lastSyncedAt', 'status_createdAt'],
      ownerCounters: ['ownerType_ownerId_key'],
    });

    expect(collection.mock.calls).toEqual([['subscriptions'], ['ownerCounters']]);
    expect(createIndexes).toHaveBeenNthCalledWith(1, [
      {
        key: { openCheckoutKey: 1 },
        name: 'one_open_checkout_per_key',
        unique: true,
        partialFilterExpression: { openCheckoutKey: { $exists: true } },
      },
      { key: { status: 1, lastSyncedAt: 1 } },
      { key: { status: 1, createdAt: 1 } },
    ]);
    expect(createIndexes).toHaveBeenNthCalledWith(2, [
      { key: { ownerType: 1, ownerId: 1, key: 1 }, unique: true },
    ]);
  });

  it('fails the run when the driver refuses an index (the deploy stops, DV-34)', async () => {
    const { db, createIndexes } = fakeDb();
    createIndexes.mockRejectedValueOnce(new Error('IndexOptionsConflict'));

    await expect(createBillingIndexes(db)).rejects.toThrow('IndexOptionsConflict');
  });

  it('is a registered migration that logs index names only', async () => {
    const { db } = fakeDb();

    expect(billingIndexes.id).toBe('0007-billing-indexes');
    await expect(billingIndexes.up(db)).resolves.toBeUndefined();
  });
});
