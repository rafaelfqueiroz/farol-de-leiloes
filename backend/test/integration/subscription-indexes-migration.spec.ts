// SPEC-012 (#12) BR-012-08, SC-11, AR-29: 0006-subscription-indexes against a real MongoDB, on a
// database no Mongoose model has touched (so nothing but the migration builds an index). The
// guarantees must hold on the migration's indexes alone: one in-effect subscription per office,
// one provider subscription per record, one plan per code and per provider price, one ledger
// document per event id. Running twice changes nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type mongo, Types } from 'mongoose';
import { createSubscriptionIndexes } from '../../src/migrations/0006-subscription-indexes.migration.js';
import { useTestDatabase } from '../support/test-database.js';

describe('0006-subscription-indexes (integration)', () => {
  const testDb = useTestDatabase();
  let connection: Connection;
  let db: mongo.Db;

  const indexesOf = async (name: string) =>
    (await db.collection(name).indexes())
      .map(({ key, name: indexName, unique, sparse, partialFilterExpression }) => ({
        key,
        name: indexName,
        ...(unique ? { unique } : {}),
        ...(sparse ? { sparse } : {}),
        ...(partialFilterExpression ? { partialFilterExpression } : {}),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const subscription = (officeId: Types.ObjectId | undefined, status: string) => ({
    ...(officeId ? { officeId } : {}),
    buyerUserId: new Types.ObjectId(),
    planId: new Types.ObjectId(),
    planCode: 'escritorio-5',
    activeJourneyLimit: 5,
    status,
    cancelAtPeriodEnd: false,
  });

  beforeAll(async () => {
    connection = await createConnection(testDb.uri).asPromise();
    if (!connection.db) throw new Error('connection has no db');
    db = connection.db;
  });

  afterAll(async () => {
    await connection.close();
  });

  it('creates the catalog, subscription and ledger indexes on empty collections', async () => {
    await createSubscriptionIndexes(db);

    expect(await indexesOf('plans')).toEqual([
      { key: { _id: 1 }, name: '_id_' },
      { key: { code: 1 }, name: 'code_1', unique: true },
      { key: { status: 1, sortOrder: 1 }, name: 'status_1_sortOrder_1' },
      { key: { stripePriceId: 1 }, name: 'stripePriceId_1', unique: true },
    ]);
    expect(await indexesOf('subscriptions')).toEqual([
      { key: { _id: 1 }, name: '_id_' },
      { key: { checkoutSessionId: 1 }, name: 'checkoutSessionId_1', unique: true, sparse: true },
      { key: { officeId: 1, createdAt: -1 }, name: 'officeId_1_createdAt_-1' },
      {
        key: { officeId: 1 },
        name: 'one_in_effect_subscription_per_office',
        unique: true,
        partialFilterExpression: {
          officeId: { $exists: true },
          status: { $in: ['ACTIVE', 'PAST_DUE', 'CANCELING'] },
        },
      },
      {
        key: { stripeSubscriptionId: 1 },
        name: 'stripeSubscriptionId_1',
        unique: true,
        sparse: true,
      },
    ]);
    expect(await indexesOf('paymentEvents')).toEqual([
      { key: { _id: 1 }, name: '_id_' },
      { key: { stripeEventId: 1 }, name: 'stripeEventId_1', unique: true },
    ]);
  });

  it('BR-012-08: refuses a second subscription in effect for an office, never a lapsed or pending one', async () => {
    const subscriptions = db.collection('subscriptions');
    const office = new Types.ObjectId();

    await subscriptions.insertOne(subscription(office, 'ACTIVE'));
    await expect(subscriptions.insertOne(subscription(office, 'PAST_DUE'))).rejects.toMatchObject({
      code: 11000,
    });
    await expect(subscriptions.insertOne(subscription(office, 'CANCELING'))).rejects.toMatchObject({
      code: 11000,
    });
    await subscriptions.insertOne(subscription(office, 'LAPSED'));
    await subscriptions.insertOne(subscription(office, 'LAPSED'));
    await subscriptions.insertOne(subscription(office, 'PENDING'));
    await subscriptions.insertOne(subscription(Types.ObjectId.createFromTime(1), 'ACTIVE'));

    expect(await subscriptions.countDocuments({ officeId: office })).toBe(4);
  });

  it('BR-012-07: first subscriptions with no office yet do not collide with each other', async () => {
    const subscriptions = db.collection('subscriptions');

    await subscriptions.insertOne(subscription(undefined, 'ACTIVE'));
    await subscriptions.insertOne(subscription(undefined, 'ACTIVE'));
    await subscriptions.insertOne(subscription(undefined, 'PENDING'));
  });

  it('SC-11: refuses a second ledger document for one event id', async () => {
    const events = db.collection('paymentEvents');

    await events.insertOne({
      stripeEventId: 'evt_1',
      type: 'invoice.paid',
      receivedAt: new Date(),
    });
    await expect(
      events.insertOne({ stripeEventId: 'evt_1', type: 'invoice.paid', receivedAt: new Date() }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('BR-012-02: refuses a second plan with the same code or the same provider price', async () => {
    const plans = db.collection('plans');
    const base = {
      name: 'P',
      audience: 'ADVISOR_OFFICE',
      interval: 'month',
      status: 'OFFERED',
      sortOrder: 0,
    };

    await plans.insertOne({ ...base, code: 'a', stripePriceId: 'price_a' });
    await expect(
      plans.insertOne({ ...base, code: 'a', stripePriceId: 'price_b' }),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      plans.insertOne({ ...base, code: 'b', stripePriceId: 'price_a' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('a second run changes nothing (idempotent, AR-29)', async () => {
    const before = [
      await indexesOf('plans'),
      await indexesOf('subscriptions'),
      await indexesOf('paymentEvents'),
    ];

    await createSubscriptionIndexes(db);

    expect([
      await indexesOf('plans'),
      await indexesOf('subscriptions'),
      await indexesOf('paymentEvents'),
    ]).toEqual(before);
  });
});
