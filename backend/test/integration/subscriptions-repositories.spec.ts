// SPEC-012 BR-012-08, BR-012-13, SC-11, TS-02: the subscription and event-ledger repositories
// against a real MongoDB, on the indexes migration 0006 builds (autoIndex is off, as in the deploy):
//
//  - the sync lease is ONE conditional update: of 10 parallel acquires exactly one wins;
//  - the sync write is conditional on the lease token, and releases the lease with it;
//  - the unique indexes: one provider subscription per record, one in effect per office, one
//    ledger document per provider event id;
//  - the single-winner claims: the office attach and the payment-failed email.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Connection, type Model, Types } from 'mongoose';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { createSubscriptionIndexes } from '../../src/migrations/0006-subscription-indexes.migration.js';
import type { SyncPatch } from '../../src/subscriptions/domain/provider-state.js';
import { PaymentEventsRepository } from '../../src/subscriptions/payment-events.repository.js';
import {
  PaymentEventEntity,
  PaymentEventSchema,
} from '../../src/subscriptions/schemas/payment-event.schema.js';
import {
  SubscriptionEntity,
  SubscriptionSchema,
  type SubscriptionDocument,
} from '../../src/subscriptions/schemas/subscription.schema.js';
import { SubscriptionsRepository } from '../../src/subscriptions/subscriptions.repository.js';
import { DAY } from '../fakes/fake-clock.js';
import { useTestDatabase } from '../support/test-database.js';

const NOW = new Date('2099-03-01T12:00:00.000Z');
const EMAIL_UNTIL = new Date(NOW.getTime() + 10 * 60_000);
const LEASE_END = new Date(NOW.getTime() + 30_000);
const BUYER = '64b7f0000000000000000b01';
const PLAN = '64b7f0000000000000000a05';
const OFFICE = '64b7f0000000000000000c01';
const OTHER_OFFICE = '64b7f0000000000000000c02';

function patch(overrides: Partial<SyncPatch> = {}): SyncPatch {
  return {
    status: 'ACTIVE',
    stripeSubscriptionId: 'sub_1',
    stripeCustomerId: 'cus_1',
    cancelAtPeriodEnd: false,
    currentPeriodStart: new Date('2099-02-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2099-03-01T00:00:00.000Z'),
    plan: null,
    scheduledPlanId: null,
    scheduledChangeAt: null,
    firstPaidAt: new Date('2099-02-01T00:00:05.000Z'),
    firstPaymentFree: false,
    lapsedAt: null,
    readOnlyAt: null,
    lastSyncedAt: NOW,
    ...overrides,
  };
}

describe('subscription repositories (integration, SPEC-012)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let subscriptions: SubscriptionsRepository;
  let events: PaymentEventsRepository;
  let model: Model<SubscriptionDocument>;
  let counter = 0;

  const pending = (officeId?: string) =>
    subscriptions.createPending({
      buyerUserId: BUYER,
      planId: PLAN,
      planCode: 'escritorio-5',
      activeJourneyLimit: 5,
      ...(officeId === undefined ? {} : { officeId }),
    });
  const raw = (id: string) => model.collection.findOne({ _id: new Types.ObjectId(id) });
  /** Takes the lease the way the service does and writes `patch` under it. */
  async function sync(
    id: string,
    over: Partial<SyncPatch> = {},
    token = `token-${(counter += 1)}`,
  ) {
    const leased = await subscriptions.acquireSyncLease(id, token, NOW, LEASE_END);
    expect(leased).not.toBeNull();
    return (await subscriptions.writeSync(id, token, patch(over))).outcome;
  }

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        // autoIndex off: the indexes below are the ones migration 0006 builds in the deploy.
        MongooseModule.forRoot(db.uri, { autoIndex: false }),
        MongooseModule.forFeature([
          { name: SubscriptionEntity.name, schema: SubscriptionSchema },
          { name: PaymentEventEntity.name, schema: PaymentEventSchema },
        ]),
      ],
      providers: [SubscriptionsRepository, PaymentEventsRepository],
    }).compile();
    subscriptions = moduleRef.get(SubscriptionsRepository);
    events = moduleRef.get(PaymentEventsRepository);
    model = moduleRef.get(getModelToken(SubscriptionEntity.name));
    const connection = moduleRef.get<Connection>(getConnectionToken());
    if (!connection.db) throw new Error('connection has no db');
    await createSubscriptionIndexes(connection.db);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await model.collection.deleteMany({});
  });

  describe('BR-012-09: created pending', () => {
    it('stores a pending subscription with its plan copy and no provider ids, and reads it back', async () => {
      const created = await pending();

      expect(created).toMatchObject({
        status: 'PENDING',
        officeId: null,
        buyerUserId: BUYER,
        planId: PLAN,
        planCode: 'escritorio-5',
        activeJourneyLimit: 5,
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: null,
        syncLeaseToken: null,
      });
      expect(await subscriptions.findById(created.id)).toEqual(created);
    });

    it('answers null for an id that is not one, never a cast error', async () => {
      expect(await subscriptions.findById('not-an-id')).toBeNull();
      expect(await subscriptions.findById('64b7f00000000000000000ff')).toBeNull();
      expect(await subscriptions.findByStripeSubscriptionId('sub_none')).toBeNull();
    });
  });

  describe('BR-012-13: the sync lease', () => {
    it('TS-02: of 10 parallel acquires exactly one wins', async () => {
      const { id } = await pending(OFFICE);

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, n) =>
          subscriptions.acquireSyncLease(id, `token-${n}`, NOW, LEASE_END),
        ),
      );

      const winners = results.filter((result) => result !== null);
      expect(winners).toHaveLength(1);
      const winner = winners[0];
      expect((await raw(id))?.syncLeaseToken).toBe(winner?.syncLeaseToken);
    });

    it('is held until its end and taken again after it (a crashed holder cannot block forever)', async () => {
      const { id } = await pending(OFFICE);
      await subscriptions.acquireSyncLease(id, 'first', NOW, LEASE_END);

      // Just before the end: still held.
      const before = new Date(LEASE_END.getTime() - 1);
      expect(await subscriptions.acquireSyncLease(id, 'second', before, LEASE_END)).toBeNull();
      // At the end: free.
      const taken = await subscriptions.acquireSyncLease(
        id,
        'second',
        LEASE_END,
        new Date(LEASE_END.getTime() + 30_000),
      );
      expect(taken?.syncLeaseToken).toBe('second');
    });

    it('gives the lease back only to its owner', async () => {
      const { id } = await pending(OFFICE);
      await subscriptions.acquireSyncLease(id, 'mine', NOW, LEASE_END);

      await subscriptions.releaseSyncLease(id, 'someone-else');
      expect((await raw(id))?.syncLeaseToken).toBe('mine');

      await subscriptions.releaseSyncLease(id, 'mine');
      const after = await raw(id);
      expect(after).not.toHaveProperty('syncLeaseToken');
      expect(after).not.toHaveProperty('syncLeaseUntil');
    });

    it('acquires nothing for an id that is not one or a record that does not exist', async () => {
      expect(await subscriptions.acquireSyncLease('nope', 't', NOW, LEASE_END)).toBeNull();
      expect(
        await subscriptions.acquireSyncLease('64b7f00000000000000000ff', 't', NOW, LEASE_END),
      ).toBeNull();
      await subscriptions.releaseSyncLease('nope', 't'); // no throw
    });

    it('BR-012-13: a write without the lease changes nothing (a stale read cannot overwrite a newer one)', async () => {
      const { id } = await pending(OFFICE);
      await subscriptions.acquireSyncLease(id, 'holder', NOW, LEASE_END);

      expect(
        await subscriptions.writeSync(id, 'a-stale-sync', patch({ status: 'LAPSED' })),
      ).toEqual({ outcome: 'lease_lost', dirty: false });

      expect(await raw(id)).toMatchObject({ status: 'PENDING', syncLeaseToken: 'holder' });
    });

    it('a write under the lease stores the sync and releases the lease in the same write', async () => {
      const { id } = await pending(OFFICE);
      const started = new Date('2099-02-01T00:00:00.000Z');

      expect(await sync(id, { currentPeriodStart: started })).toBe('written');

      const stored = await subscriptions.findById(id);
      expect(stored).toMatchObject({
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_1',
        stripeCustomerId: 'cus_1',
        currentPeriodStart: started,
        firstPaidAt: new Date('2099-02-01T00:00:05.000Z'),
        lastSyncedAt: NOW,
        syncLeaseToken: null,
        syncLeaseUntil: null,
      });
    });

    it('a second write with the same token no longer matches (the lease went with the first)', async () => {
      const { id } = await pending(OFFICE);
      await sync(id, {}, 'once');

      expect((await subscriptions.writeSync(id, 'once', patch({ status: 'LAPSED' }))).outcome).toBe(
        'lease_lost',
      );
      expect((await raw(id))?.status).toBe('ACTIVE');
    });

    it('clears what the provider no longer has (a lapse that ended, a cancelled schedule)', async () => {
      const { id } = await pending(OFFICE);
      const lapsedAt = new Date('2099-02-20T00:00:00.000Z');
      await sync(id, {
        status: 'LAPSED',
        lapsedAt,
        readOnlyAt: new Date('2099-03-02T00:00:00.000Z'),
        scheduledPlanId: PLAN,
        scheduledChangeAt: NOW,
      });
      expect(await raw(id)).toMatchObject({ lapsedAt, scheduledPlanId: new Types.ObjectId(PLAN) });

      await sync(id, { status: 'ACTIVE' });

      const after = await raw(id);
      for (const cleared of ['lapsedAt', 'readOnlyAt', 'scheduledPlanId', 'scheduledChangeAt']) {
        expect(after).not.toHaveProperty(cleared);
      }
    });

    it('BR-012-16: the plan and its copied limit change together, and only when the patch says so', async () => {
      const { id } = await pending(OFFICE);
      const newPlan = '64b7f0000000000000000a09';

      await sync(id, { plan: { id: newPlan, code: 'escritorio-9', activeJourneyLimit: 9 } });
      expect(await subscriptions.findById(id)).toMatchObject({
        planId: newPlan,
        planCode: 'escritorio-9',
        activeJourneyLimit: 9,
      });

      await sync(id, { plan: null });
      expect(await subscriptions.findById(id)).toMatchObject({
        planCode: 'escritorio-9',
        activeJourneyLimit: 9,
      });
    });
  });

  describe('BR-012-13: the re-sync request (dirty mark) is atomic with the lease', () => {
    it('matches only while a lease is live: a free or expired lease takes no request', async () => {
      const { id } = await pending(OFFICE);

      expect(await subscriptions.markSyncRequested(id, NOW)).toBe(false); // never leased
      await subscriptions.acquireSyncLease(id, 'holder', NOW, LEASE_END);
      expect(await subscriptions.markSyncRequested(id, NOW)).toBe(true);
      expect(await subscriptions.markSyncRequested(id, LEASE_END)).toBe(false); // expired
      expect(await subscriptions.markSyncRequested('nope', NOW)).toBe(false);
    });

    it('a request that landed before the write is seen by it (dirty) and cleared with the release', async () => {
      const { id } = await pending(OFFICE);
      await subscriptions.acquireSyncLease(id, 'holder', NOW, LEASE_END);
      await subscriptions.markSyncRequested(id, NOW);

      const result = await subscriptions.writeSync(id, 'holder', patch());

      expect(result).toEqual({ outcome: 'written', dirty: true });
      const after = await raw(id);
      expect(after).not.toHaveProperty('syncRequestedAt');
      expect(after).not.toHaveProperty('syncLeaseToken');
    });

    it('a write nobody asked about is clean, and a request after the release matches nothing', async () => {
      const { id } = await pending(OFFICE);
      await subscriptions.acquireSyncLease(id, 'holder', NOW, LEASE_END);

      expect(await subscriptions.writeSync(id, 'holder', patch())).toEqual({
        outcome: 'written',
        dirty: false,
      });
      expect(await subscriptions.markSyncRequested(id, NOW)).toBe(false);
    });

    it('a stale request left by a crashed holder is cleared when the lease is taken again', async () => {
      const { id } = await pending(OFFICE);
      await subscriptions.acquireSyncLease(id, 'crashed', NOW, LEASE_END);
      await subscriptions.markSyncRequested(id, NOW);

      await subscriptions.acquireSyncLease(
        id,
        'next',
        LEASE_END,
        new Date(LEASE_END.getTime() + 30_000),
      );

      expect(await raw(id)).not.toHaveProperty('syncRequestedAt');
      expect(await subscriptions.writeSync(id, 'next', patch())).toMatchObject({ dirty: false });
    });

    it('TS-02: with the holder writing while 10 deliveries ask, each request either is seen by the write or matched nothing', async () => {
      const { id } = await pending(OFFICE);
      await subscriptions.acquireSyncLease(id, 'holder', NOW, LEASE_END);

      const [write, ...requests] = await Promise.all([
        subscriptions.writeSync(id, 'holder', patch()),
        ...Array.from({ length: 10 }, () => subscriptions.markSyncRequested(id, NOW)),
      ]);

      const landed = requests.filter((matched) => matched === true).length;
      // Either some request landed before the write (the write is dirty) or none did.
      expect(write).toMatchObject({ outcome: 'written', dirty: landed > 0 });
    });
  });

  describe('BR-012-08: the conflicting subscription of an office', () => {
    it('finds the one in effect, other than the one asked about', async () => {
      const inEffect = await pending(OFFICE);
      await sync(inEffect.id);
      const incoming = await pending(OFFICE);

      expect((await subscriptions.findInEffectForOffice(OFFICE, incoming.id))?.id).toBe(
        inEffect.id,
      );
      expect(await subscriptions.findInEffectForOffice(OFFICE, inEffect.id)).toBeNull();
      expect(await subscriptions.findInEffectForOffice(OTHER_OFFICE, incoming.id)).toBeNull();
      expect(await subscriptions.findInEffectForOffice('nope', incoming.id)).toBeNull();
    });
  });

  describe('BR-012-13: a provider subscription is stored once', () => {
    it('refuses the same provider subscription id on two records (unique index)', async () => {
      const first = await pending(OFFICE);
      const second = await pending(OTHER_OFFICE);
      await sync(first.id);

      await expect(sync(second.id)).rejects.toMatchObject({ code: 11000 });
    });

    it('allows many records that have no provider subscription yet (sparse)', async () => {
      await pending();
      await pending();
      await pending();

      expect(await model.countDocuments()).toBe(3);
    });
  });

  describe('BR-012-08: at most one subscription in effect per office', () => {
    it('refuses a second in-effect subscription of an office, writing nothing, and keeps the first', async () => {
      const first = await pending(OFFICE);
      const second = await pending(OFFICE);
      expect(await sync(first.id)).toBe('written');

      const outcome = await sync(second.id, { stripeSubscriptionId: 'sub_2' });

      expect(outcome).toBe('duplicate_in_effect');
      expect(await raw(second.id)).toMatchObject({ status: 'PENDING' });
      expect((await raw(first.id))?.status).toBe('ACTIVE');
    });

    it.each(['ACTIVE', 'PAST_DUE', 'CANCELING'] as const)(
      'treats %s as in effect for the index',
      async (status) => {
        const first = await pending(OFFICE);
        const second = await pending(OFFICE);
        await sync(first.id, { status });

        expect(await sync(second.id, { status: 'ACTIVE', stripeSubscriptionId: 'sub_2' })).toBe(
          'duplicate_in_effect',
        );
      },
    );

    it('allows any number of PENDING and LAPSED subscriptions beside the one in effect', async () => {
      const inEffect = await pending(OFFICE);
      const lapsedOne = await pending(OFFICE);
      const lapsedTwo = await pending(OFFICE);
      await pending(OFFICE); // pending
      await pending(OFFICE); // pending

      expect(await sync(inEffect.id)).toBe('written');
      expect(
        await sync(lapsedOne.id, {
          status: 'LAPSED',
          stripeSubscriptionId: 'sub_l1',
          lapsedAt: NOW,
        }),
      ).toBe('written');
      expect(
        await sync(lapsedTwo.id, {
          status: 'LAPSED',
          stripeSubscriptionId: 'sub_l2',
          lapsedAt: NOW,
        }),
      ).toBe('written');
    });

    it('lets a new subscription take effect once the previous one lapsed', async () => {
      const old = await pending(OFFICE);
      const fresh = await pending(OFFICE);
      await sync(old.id);
      await sync(old.id, { status: 'LAPSED', lapsedAt: NOW });

      expect(await sync(fresh.id, { stripeSubscriptionId: 'sub_2' })).toBe('written');
    });

    it('does not mix up offices', async () => {
      const a = await pending(OFFICE);
      const b = await pending(OTHER_OFFICE);

      expect(await sync(a.id)).toBe('written');
      expect(await sync(b.id, { stripeSubscriptionId: 'sub_2' })).toBe('written');
    });

    it('does not collide first subscriptions that have no office yet (absent officeId)', async () => {
      const a = await pending();
      const b = await pending();

      expect(await sync(a.id)).toBe('written');
      expect(await sync(b.id, { stripeSubscriptionId: 'sub_2' })).toBe('written');
    });
  });

  describe('BR-012-07: attaching the office of a first payment', () => {
    it('of 10 parallel attaches exactly one wins, and the first office is kept', async () => {
      const { id } = await pending();
      const offices = Array.from({ length: 10 }, (_, n) =>
        new Types.ObjectId(`64b7f0000000000000cc00${String(n).padStart(2, '0')}`).toHexString(),
      );

      const results = await Promise.all(
        offices.map((office) => subscriptions.attachOffice(id, office, NOW)),
      );

      expect(results.filter((result) => result === 'attached')).toHaveLength(1);
      expect(results.filter((result) => result === 'already_attached')).toHaveLength(9);
      const stored = await subscriptions.findById(id);
      expect(stored?.provisionedAt).toEqual(NOW);
      expect(offices).toContain(stored?.officeId);
    });

    it('refuses an office that already has another subscription in effect (BR-012-08)', async () => {
      const first = await pending(OFFICE);
      await sync(first.id);
      const second = await pending();
      await sync(second.id, { stripeSubscriptionId: 'sub_2' });

      expect(await subscriptions.attachOffice(second.id, OFFICE, NOW)).toBe('duplicate_in_effect');
      expect((await subscriptions.findById(second.id))?.officeId).toBeNull();
    });
  });

  describe('an abandoned checkout leaves nothing', () => {
    const pendingWithSession = (checkoutSessionId: string) =>
      subscriptions.createPending({
        buyerUserId: BUYER,
        planId: PLAN,
        planCode: 'escritorio-5',
        activeJourneyLimit: 5,
        checkoutSessionId,
      });

    it('removes the pending subscription of that checkout session, once, and no other', async () => {
      await pendingWithSession('cs_a');
      const other = await pendingWithSession('cs_b');

      expect(await subscriptions.deleteAbandonedPending('cs_a')).toBe(true);
      expect(await subscriptions.deleteAbandonedPending('cs_a')).toBe(false);
      expect((await model.find().lean().exec()).map((row) => String(row._id))).toEqual([other.id]);
    });

    it('never removes one the provider confirmed or one that has a provider subscription', async () => {
      const confirmed = await pendingWithSession('cs_confirmed');
      await sync(confirmed.id);
      const withProvider = await pendingWithSession('cs_with_provider');
      await sync(withProvider.id, { status: 'PENDING', stripeSubscriptionId: 'sub_2' });

      expect(await subscriptions.deleteAbandonedPending('cs_confirmed')).toBe(false);
      expect(await subscriptions.deleteAbandonedPending('cs_with_provider')).toBe(false);
      expect(await subscriptions.deleteAbandonedPending('')).toBe(false);
      expect(await subscriptions.deleteAbandonedPending('cs_none')).toBe(false);
      expect(await model.countDocuments()).toBe(2);
    });
  });

  describe('BR-012-21: the subscriptions that decide an office plan', () => {
    it('answers the ones in effect and the lapsed ones that were paid, for the offices asked, in one query', async () => {
      const inEffect = await pending(OFFICE);
      await sync(inEffect.id);
      const lapsedPaid = await pending(OTHER_OFFICE);
      await sync(lapsedPaid.id, { status: 'LAPSED', stripeSubscriptionId: 'sub_2', lapsedAt: NOW });
      const lapsedUnpaid = await pending(OTHER_OFFICE);
      await sync(lapsedUnpaid.id, {
        status: 'LAPSED',
        stripeSubscriptionId: 'sub_3',
        lapsedAt: NOW,
        firstPaidAt: null,
      });
      await pending(OFFICE); // pending says nothing
      const elsewhere = await pending('64b7f0000000000000000c03');
      await sync(elsewhere.id, { stripeSubscriptionId: 'sub_4' });

      const rows = await subscriptions.findDecidingForOffices([OFFICE, OTHER_OFFICE, 'not-an-id']);

      expect(rows.map((row) => [row.officeId, row.status]).sort()).toEqual([
        [OFFICE, 'ACTIVE'],
        [OTHER_OFFICE, 'LAPSED'],
      ]);
      expect(rows.find((row) => row.officeId === OTHER_OFFICE)).toMatchObject({
        lapsedAt: NOW,
        firstPaidAt: new Date('2099-02-01T00:00:05.000Z'),
      });
    });

    it('asks nothing of the database for no valid office', async () => {
      expect(await subscriptions.findDecidingForOffices([])).toEqual([]);
      expect(await subscriptions.findDecidingForOffices(['nope'])).toEqual([]);
    });
  });

  describe('SC-11: the event ledger', () => {
    it('TS-02: of 10 parallel first deliveries of one event exactly one is new', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => events.record('evt_race', 'checkout.completed', NOW)),
      );

      expect(results.filter((result) => result === 'new')).toHaveLength(1);
      expect(results.filter((result) => result === 'unprocessed')).toHaveLength(9);
    });

    it('tells a delivery repeated after success from one repeated after a crash', async () => {
      expect(await events.record('evt_1', 'invoice.paid', NOW)).toBe('new');
      expect(await events.record('evt_1', 'invoice.paid', NOW)).toBe('unprocessed');

      await events.markProcessed('evt_1', NOW);

      expect(await events.record('evt_1', 'invoice.paid', NOW)).toBe('processed');
    });

    it('marks an event processed once: the first instant stays', async () => {
      await events.record('evt_2', 'invoice.paid', NOW);
      await events.markProcessed('evt_2', NOW);
      await events.markProcessed('evt_2', new Date(NOW.getTime() + DAY));

      const stored = await model.db.collection('paymentEvents').findOne({ stripeEventId: 'evt_2' });
      expect(stored?.processedAt).toEqual(NOW);
    });

    it('BR-012-20: of 10 parallel claims of the email exactly one wins; a release lets the retry claim it', async () => {
      await events.record('evt_3', 'invoice.payment_failed', NOW);

      const claims = await Promise.all(
        Array.from({ length: 10 }, () => events.claimEmail('evt_3', NOW, EMAIL_UNTIL)),
      );
      expect(claims.filter(Boolean)).toHaveLength(1);

      await events.releaseEmailClaim('evt_3');
      expect(await events.claimEmail('evt_3', NOW, EMAIL_UNTIL)).toBe(true);
      expect(await events.claimEmail('evt_3', NOW, EMAIL_UNTIL)).toBe(false);
    });

    it('BR-012-20: a claim whose sender died expires and can be taken again; once somebody was told it never can', async () => {
      await events.record('evt_5', 'invoice.payment_failed', NOW);
      expect(await events.claimEmail('evt_5', NOW, EMAIL_UNTIL)).toBe(true);

      expect(
        await events.claimEmail('evt_5', new Date(EMAIL_UNTIL.getTime() - 1), EMAIL_UNTIL),
      ).toBe(false);
      expect(await events.claimEmail('evt_5', EMAIL_UNTIL, EMAIL_UNTIL)).toBe(true);

      await events.markEmailSent('evt_5', EMAIL_UNTIL);
      await events.releaseEmailClaim('evt_5'); // too late: it was sent
      expect(
        await events.claimEmail('evt_5', new Date(EMAIL_UNTIL.getTime() + DAY), EMAIL_UNTIL),
      ).toBe(false);
    });

    it('claims nothing for an event that was never recorded', async () => {
      expect(await events.claimEmail('evt_unknown', NOW, EMAIL_UNTIL)).toBe(false);
    });

    it('SC-15: the ledger holds ids and instants only', async () => {
      await events.record('evt_4', 'invoice.payment_failed', NOW);
      await events.claimEmail('evt_4', NOW, EMAIL_UNTIL);
      await events.markProcessed('evt_4', NOW);

      const stored = await model.db.collection('paymentEvents').findOne({ stripeEventId: 'evt_4' });

      expect(Object.keys(stored ?? {}).sort()).toEqual([
        '__v',
        '_id',
        'createdAt',
        'emailClaimedAt',
        'emailClaimedUntil',
        'processedAt',
        'receivedAt',
        'stripeEventId',
        'type',
        'updatedAt',
      ]);
    });
  });
});
