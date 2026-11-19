// SPEC-012 (#12) BR-012-08, SC-11, AR-29: 0006-subscription-indexes against a recording fake of the
// driver (TS-04: the expectations are the exact index specs). That they equal the schemas' is
// subscriptions/schemas/subscription-indexes.spec.ts (AR-09 keeps the schemas inside their
// modules); the run against MongoDB is test/integration/subscription-indexes-migration.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import {
  createSubscriptionIndexes,
  subscriptionIndexes,
} from './0006-subscription-indexes.migration.js';

function fakeDb() {
  const createIndexes = vi.fn((indexes: mongo.IndexDescription[]) =>
    Promise.resolve(indexes.map((index) => index.name ?? Object.keys(index.key).join('_'))),
  );
  const collection = vi.fn().mockReturnValue({ createIndexes });
  return { db: { collection } as unknown as mongo.Db, collection, createIndexes };
}

describe('createSubscriptionIndexes', () => {
  it('creates the catalog, the subscription and the event ledger indexes', async () => {
    const { db, collection, createIndexes } = fakeDb();

    await expect(createSubscriptionIndexes(db)).resolves.toEqual({
      plans: ['code', 'stripePriceId', 'status_sortOrder'],
      subscriptions: [
        'stripeSubscriptionId',
        'checkoutSessionId',
        'one_in_effect_subscription_per_office',
        'officeId_createdAt',
      ],
      paymentEvents: ['stripeEventId'],
    });

    expect(collection.mock.calls).toEqual([['plans'], ['subscriptions'], ['paymentEvents']]);
    expect(createIndexes).toHaveBeenNthCalledWith(2, [
      { key: { stripeSubscriptionId: 1 }, unique: true, sparse: true },
      { key: { checkoutSessionId: 1 }, unique: true, sparse: true },
      {
        key: { officeId: 1 },
        name: 'one_in_effect_subscription_per_office',
        unique: true,
        partialFilterExpression: {
          officeId: { $exists: true },
          status: { $in: ['ACTIVE', 'PAST_DUE', 'CANCELING'] },
        },
      },
      { key: { officeId: 1, createdAt: -1 } },
    ]);
    expect(createIndexes).toHaveBeenNthCalledWith(3, [{ key: { stripeEventId: 1 }, unique: true }]);
  });

  it('fails the run when the driver refuses an index (the deploy stops, DV-34)', async () => {
    const { db, createIndexes } = fakeDb();
    createIndexes.mockRejectedValueOnce(new Error('IndexOptionsConflict'));

    await expect(createSubscriptionIndexes(db)).rejects.toThrow('IndexOptionsConflict');
  });
});

describe('0006-subscription-indexes', () => {
  it('has the id its file name gives and creates the indexes', async () => {
    const { db, createIndexes } = fakeDb();

    expect(subscriptionIndexes.id).toBe('0006-subscription-indexes');
    await subscriptionIndexes.up(db);

    expect(createIndexes).toHaveBeenCalledTimes(3);
  });
});
