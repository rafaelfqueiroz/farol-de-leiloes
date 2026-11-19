// SPEC-012 (#12) BR-012-07, BR-012-08, AR-15, AR-29: 0007-billing-indexes against a real MongoDB, on
// a database no Mongoose model has touched (so nothing but the migration builds an index). The
// guarantees must hold on the migration's indexes alone: one open checkout per key, one counter per
// owner and key. Running twice changes nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type mongo, Types } from 'mongoose';
import { createBillingIndexes } from '../../src/migrations/0007-billing-indexes.migration.js';
import { useTestDatabase } from '../support/test-database.js';

describe('0007-billing-indexes (integration)', () => {
  const testDb = useTestDatabase();
  let connection: Connection;
  let db: mongo.Db;

  const indexesOf = async (name: string) =>
    (await db.collection(name).indexes())
      .map(({ key, name: indexName, unique, partialFilterExpression }) => ({
        key,
        name: indexName,
        ...(unique ? { unique } : {}),
        ...(partialFilterExpression ? { partialFilterExpression } : {}),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const checkout = (openCheckoutKey?: string) => ({
    buyerUserId: new Types.ObjectId(),
    planId: new Types.ObjectId(),
    planCode: 'escritorio-5',
    activeJourneyLimit: 5,
    status: 'PENDING',
    cancelAtPeriodEnd: false,
    ...(openCheckoutKey === undefined ? {} : { openCheckoutKey }),
  });

  beforeAll(async () => {
    connection = await createConnection(testDb.uri).asPromise();
    if (!connection.db) throw new Error('connection has no db');
    db = connection.db;
  });

  afterAll(async () => {
    await connection.close();
  });

  it('creates the billing indexes on empty collections', async () => {
    await createBillingIndexes(db);

    expect(await indexesOf('subscriptions')).toEqual([
      { key: { _id: 1 }, name: '_id_' },
      {
        key: { openCheckoutKey: 1 },
        name: 'one_open_checkout_per_key',
        unique: true,
        partialFilterExpression: { openCheckoutKey: { $exists: true } },
      },
      { key: { status: 1, createdAt: 1 }, name: 'status_1_createdAt_1' },
      { key: { status: 1, lastSyncedAt: 1 }, name: 'status_1_lastSyncedAt_1' },
    ]);
    expect(await indexesOf('ownerCounters')).toEqual([
      { key: { _id: 1 }, name: '_id_' },
      {
        key: { ownerType: 1, ownerId: 1, key: 1 },
        name: 'ownerType_1_ownerId_1_key_1',
        unique: true,
      },
    ]);
  });

  it('BR-012-07, BR-012-08: refuses a second open checkout under one key, never a record without one', async () => {
    const subscriptions = db.collection('subscriptions');

    await subscriptions.insertOne(checkout('buyer:1'));
    await expect(subscriptions.insertOne(checkout('buyer:1'))).rejects.toMatchObject({
      code: 11000,
    });
    await subscriptions.insertOne(checkout('office:1'));
    await subscriptions.insertOne(checkout());
    await subscriptions.insertOne(checkout());
  });

  it('AR-15: refuses a second counter for one owner and key', async () => {
    const counters = db.collection('ownerCounters');
    const owner = new Types.ObjectId();
    const counter = (key: string, ownerId = owner) => ({
      ownerType: 'office',
      ownerId,
      key,
      value: 0,
    });

    await counters.insertOne(counter('journeys.active'));
    await expect(counters.insertOne(counter('journeys.active'))).rejects.toMatchObject({
      code: 11000,
    });
    await counters.insertOne(counter('other'));
    await counters.insertOne(counter('journeys.active', new Types.ObjectId()));
  });

  it('is idempotent (AR-29): running it again changes nothing', async () => {
    const before = await indexesOf('subscriptions');

    await createBillingIndexes(db);

    expect(await indexesOf('subscriptions')).toEqual(before);
  });
});
