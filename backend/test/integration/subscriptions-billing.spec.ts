// SPEC-012 BR-012-07, BR-012-08, BR-012-29, SC-11, TS-02: the billing PR's conditional writes
// against a real MongoDB, on the indexes migrations 0006 and 0007 build (autoIndex is off, as in
// the deploy):
//
//  - one open checkout per key, released once the provider moves the subscription on;
//  - the refund claim is ONE conditional update: of 20 parallel claims exactly one wins, a stale
//    claim can be retaken, a refunded subscription cannot be claimed again;
//  - the same event id is claimed by one delivery at a time;
//  - the reconcile job's read and the purge of abandoned checkouts;
//  - two members cancelling at the same moment refund once, end to end through the billing service.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Connection, type Model, Types } from 'mongoose';
import type { OwnerCounterRepository } from '../../src/access/owner-counter.repository.js';
import type { OfficePlanState } from '../../src/access/sources/office-plan.source.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import type { CouponsService } from '../../src/coupons/coupons.service.js';
import { createBillingIndexes } from '../../src/migrations/0007-billing-indexes.migration.js';
import { createSubscriptionIndexes } from '../../src/migrations/0006-subscription-indexes.migration.js';
import type { PlansService } from '../../src/plans/plans.service.js';
import type { SyncPatch } from '../../src/subscriptions/domain/provider-state.js';
import { JourneySlotsService } from '../../src/subscriptions/journey-slots.service.js';
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
import { SubscriptionsBillingService } from '../../src/subscriptions/subscriptions-billing.service.js';
import {
  OpenCheckoutExistsError,
  SubscriptionsRepository,
} from '../../src/subscriptions/subscriptions.repository.js';
import { SubscriptionsService } from '../../src/subscriptions/subscriptions.service.js';
import { aPlan } from '../builders/plan.builder.js';
import { aProviderSubscription } from '../builders/provider-subscription.builder.js';
import { anAccessContext } from '../fakes/fake-access-sources.js';
import { DAY, FakeClock, HOUR, MINUTE } from '../fakes/fake-clock.js';
import { FakeCoupons } from '../fakes/fake-coupons.js';
import { FakeOfficeProvisioner } from '../fakes/fake-office-provisioner.js';
import { FakeOwnerCounters } from '../fakes/fake-owner-counters.js';
import { FakePaymentFailedNotifier } from '../fakes/fake-payment-failed-notifier.js';
import { FakePaymentGateway } from '../fakes/fake-payment-gateway.js';
import { InMemoryPlans } from '../fakes/in-memory-plans.js';
import { useTestDatabase } from '../support/test-database.js';
import { testBusinessConfig, testConfigService } from '../support/test-env.js';

const NOW = new Date('2099-03-01T12:00:00.000Z');
const BUYER = '64b7f0000000000000000b01';
const SECOND_MEMBER = '64b7f0000000000000000b02';
const PLAN = aPlan({ id: '64b7f0000000000000000a05', stripePriceId: 'price_5' });
const OFFICE = '64b7f0000000000000000c01';
const OTHER_OFFICE = '64b7f0000000000000000c02';
const WRITABLE: OfficePlanState = { advisorPlanActive: true, readOnly: false, entitlements: [] };

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
    lapsedAt: null,
    readOnlyAt: null,
    lastSyncedAt: NOW,
    ...overrides,
  };
}

describe('billing repositories (integration, SPEC-012)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let subscriptions: SubscriptionsRepository;
  let events: PaymentEventsRepository;
  let model: Model<SubscriptionDocument>;
  let eventModel: Model<PaymentEventEntity>;
  let counter = 0;

  const pending = (extra: { officeId?: string; openCheckoutKey?: string } = {}) =>
    subscriptions.createPending({
      buyerUserId: BUYER,
      planId: PLAN.id,
      planCode: PLAN.code,
      activeJourneyLimit: 5,
      ...extra,
    });
  const raw = (id: string) => model.collection.findOne({ _id: new Types.ObjectId(id) });
  /** A subscription of the office confirmed by the provider (what a sync writes). */
  async function inEffect(officeId: string, over: Partial<SyncPatch> = {}) {
    counter += 1;
    const created = await pending({ officeId });
    const token = `token-${counter}`;
    await subscriptions.acquireSyncLease(created.id, token, NOW, new Date(NOW.getTime() + 30_000));
    await subscriptions.writeSync(
      created.id,
      token,
      patch({ stripeSubscriptionId: `sub_${counter}`, ...over }),
    );
    return created.id;
  }

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        // autoIndex off: the indexes below are the ones migrations 0006 and 0007 build.
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
    eventModel = moduleRef.get(getModelToken(PaymentEventEntity.name));
    const connection = moduleRef.get<Connection>(getConnectionToken());
    if (!connection.db) throw new Error('connection has no db');
    await createSubscriptionIndexes(connection.db);
    await createBillingIndexes(connection.db);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await model.collection.deleteMany({});
    await eventModel.collection.deleteMany({});
  });

  describe('BR-012-07, BR-012-08: one open checkout per key', () => {
    it('refuses a second checkout under the same key, even 20 at once, and allows other keys', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => pending({ openCheckoutKey: `buyer:${BUYER}` })),
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      for (const result of results.filter((entry) => entry.status === 'rejected')) {
        expect((result as PromiseRejectedResult).reason).toBeInstanceOf(OpenCheckoutExistsError);
      }
      await pending({ openCheckoutKey: `office:${OFFICE}` });
      await pending(); // no key: nothing to collide with (a seeded sync record)
      await pending();
    });

    it('finds the open checkout by key, and releases the key when the provider moves it out of PENDING', async () => {
      const created = await pending({ openCheckoutKey: `buyer:${BUYER}` });
      expect((await subscriptions.findOpenCheckout(`buyer:${BUYER}`))?.id).toBe(created.id);
      expect(await subscriptions.findOpenCheckout('buyer:nobody')).toBeNull();

      const token = 'token-release';
      await subscriptions.acquireSyncLease(
        created.id,
        token,
        NOW,
        new Date(NOW.getTime() + 30_000),
      );
      await subscriptions.writeSync(created.id, token, patch({ status: 'PENDING' }));
      expect(await subscriptions.findOpenCheckout(`buyer:${BUYER}`)).not.toBeNull(); // still incomplete

      await subscriptions.acquireSyncLease(
        created.id,
        token,
        NOW,
        new Date(NOW.getTime() + 30_000),
      );
      await subscriptions.writeSync(created.id, token, patch({ status: 'ACTIVE' }));

      expect(await subscriptions.findOpenCheckout(`buyer:${BUYER}`)).toBeNull();
      expect(await raw(created.id)).not.toHaveProperty('openCheckoutKey');
      await pending({ openCheckoutKey: `buyer:${BUYER}` }); // the buyer may start another
    });

    it('stores the session once on a PENDING record, and removes a record only while it is an unpaid PENDING', async () => {
      const created = await pending({ openCheckoutKey: `buyer:${BUYER}` });

      expect(await subscriptions.setCheckoutSession(created.id, 'cs_1', 'cus_1')).toBe(true);
      expect(await subscriptions.setCheckoutSession(created.id, 'cs_2', 'cus_2')).toBe(false);
      expect(await raw(created.id)).toMatchObject({
        checkoutSessionId: 'cs_1',
        stripeCustomerId: 'cus_1',
      });

      const paid = await inEffect(OFFICE);
      expect(await subscriptions.deletePendingById(paid)).toBe(false); // in effect: never removed
      expect(await subscriptions.deletePendingById('not-an-id')).toBe(false);
      expect(await subscriptions.deletePendingById(created.id)).toBe(true);
      expect(await subscriptions.findOpenCheckout(`buyer:${BUYER}`)).toBeNull();
    });
  });

  describe('BR-012-29: the refund claim', () => {
    const STALE = new Date(NOW.getTime() - 5 * MINUTE);

    it('of 20 parallel claims exactly one wins', async () => {
      const id = await inEffect(OFFICE);

      const claims = await Promise.all(
        Array.from({ length: 20 }, () => subscriptions.claimRefund(id, NOW, STALE)),
      );

      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(await raw(id)).toMatchObject({ refundClaimedAt: NOW });
    });

    it('a claim younger than 5 minutes holds; an older one (a caller that died) can be retaken', async () => {
      const id = await inEffect(OFFICE);
      expect(await subscriptions.claimRefund(id, NOW, STALE)).toBe(true);

      const later = new Date(NOW.getTime() + 4 * MINUTE);
      expect(
        await subscriptions.claimRefund(id, later, new Date(later.getTime() - 5 * MINUTE)),
      ).toBe(false);
      const muchLater = new Date(NOW.getTime() + 5 * MINUTE);
      expect(
        await subscriptions.claimRefund(id, muchLater, new Date(muchLater.getTime() - 5 * MINUTE)),
      ).toBe(true);
    });

    it('records the refund once, and a refunded subscription can never be claimed again', async () => {
      const id = await inEffect(OFFICE);
      await subscriptions.claimRefund(id, NOW, STALE);

      expect(await subscriptions.markRefunded(id, NOW)).toBe(true);
      expect(await subscriptions.markRefunded(id, new Date(NOW.getTime() + HOUR))).toBe(false);

      expect(await raw(id)).toMatchObject({ refundedAt: NOW });
      const much = new Date(NOW.getTime() + DAY);
      expect(await subscriptions.claimRefund(id, much, new Date(much.getTime() - 5 * MINUTE))).toBe(
        false,
      );
    });

    it('only a subscription in effect can be claimed', async () => {
      const lapsed = await inEffect(OFFICE, { status: 'LAPSED', lapsedAt: NOW });
      const unpaid = await pending({ officeId: OTHER_OFFICE });

      expect(await subscriptions.claimRefund(lapsed, NOW, STALE)).toBe(false);
      expect(await subscriptions.claimRefund(unpaid.id, NOW, STALE)).toBe(false);
      expect(await subscriptions.claimRefund('not-an-id', NOW, STALE)).toBe(false);
    });
  });

  describe('BR-012-29, BR-012-11: reads for the billing view', () => {
    it('knows whether an earlier subscription of the office was paid before this one', async () => {
      const first = await inEffect(OFFICE, {
        status: 'LAPSED',
        lapsedAt: NOW,
        firstPaidAt: new Date('2099-01-01T00:00:00.000Z'),
      });
      const second = await inEffect(OFFICE, { firstPaidAt: new Date('2099-02-01T00:00:00.000Z') });
      const other = await inEffect(OTHER_OFFICE, {
        firstPaidAt: new Date('2099-02-01T00:00:00.000Z'),
      });

      expect(
        await subscriptions.existsEarlierPaid(OFFICE, second, new Date('2099-02-01T00:00:00.000Z')),
      ).toBe(true);
      expect(
        await subscriptions.existsEarlierPaid(OFFICE, first, new Date('2099-01-01T00:00:00.000Z')),
      ).toBe(false); // a later one does not make the first not-first
      expect(
        await subscriptions.existsEarlierPaid(
          OTHER_OFFICE,
          other,
          new Date('2099-02-01T00:00:00.000Z'),
        ),
      ).toBe(false); // another office's history is not this office's
      expect(await subscriptions.existsEarlierPaid('not-an-id', second, NOW)).toBe(false);
    });

    it('reads the subscription in effect, the latest ones newest first, and the customer an office already has', async () => {
      const lapsed = await inEffect(OFFICE, {
        status: 'LAPSED',
        lapsedAt: NOW,
        stripeCustomerId: 'cus_old',
      });
      const current = await inEffect(OFFICE, { stripeCustomerId: 'cus_new' });

      expect((await subscriptions.findInEffectByOffice(OFFICE))?.id).toBe(current);
      expect(await subscriptions.findInEffectByOffice(OTHER_OFFICE)).toBeNull();
      expect((await subscriptions.findRecentForOffice(OFFICE, 10)).map((row) => row.id)).toEqual([
        current,
        lapsed,
      ]);
      expect((await subscriptions.findRecentForOffice(OFFICE, 1)).map((row) => row.id)).toEqual([
        current,
      ]);
      expect(await subscriptions.findCustomerIdOfOffice(OFFICE)).toBe('cus_new');
      expect(await subscriptions.findCustomerIdOfOffice(OTHER_OFFICE)).toBeNull();
      expect(await subscriptions.findInEffectByOffice('x')).toBeNull();
      expect(await subscriptions.findRecentForOffice('x', 5)).toEqual([]);
      expect(await subscriptions.findCustomerIdOfOffice('x')).toBeNull();
    });
  });

  describe('ADR-005: the reconcile job reads', () => {
    it('selects, oldest sync first, the records with a provider subscription synced before the cutoff, not lapsed long ago', async () => {
      const staleBefore = new Date(NOW.getTime() - 12 * HOUR);
      const lapsedSince = new Date(NOW.getTime() - 14 * DAY);
      const old = await inEffect('64b7f0000000000000000c11', {
        lastSyncedAt: new Date(NOW.getTime() - 30 * HOUR),
      });
      const stale = await inEffect('64b7f0000000000000000c12', {
        lastSyncedAt: new Date(NOW.getTime() - 13 * HOUR),
      });
      await inEffect('64b7f0000000000000000c13', {
        lastSyncedAt: new Date(NOW.getTime() - 1 * HOUR),
      });
      const recentLapse = await inEffect('64b7f0000000000000000c14', {
        status: 'LAPSED',
        lapsedAt: new Date(NOW.getTime() - 13 * DAY),
        lastSyncedAt: new Date(NOW.getTime() - 20 * HOUR),
      });
      await inEffect('64b7f0000000000000000c15', {
        status: 'LAPSED',
        lapsedAt: new Date(NOW.getTime() - 15 * DAY),
        lastSyncedAt: new Date(NOW.getTime() - 20 * HOUR),
      });
      await pending({ officeId: '64b7f0000000000000000c16' }); // no provider subscription yet

      const due = await subscriptions.findIdsToReconcile({ staleBefore, lapsedSince, limit: 10 });

      expect(due.map((entry) => entry.id)).toEqual([old, recentLapse, stale]);
      expect(due.map((entry) => entry.status)).toEqual(['ACTIVE', 'LAPSED', 'ACTIVE']);
      expect(
        (await subscriptions.findIdsToReconcile({ staleBefore, lapsedSince, limit: 2 })).map(
          (entry) => entry.id,
        ),
      ).toEqual([old, recentLapse]);
    });

    it('a record never synced is due', async () => {
      const created = await pending({ officeId: OFFICE });
      await model.collection.updateOne(
        { _id: new Types.ObjectId(created.id) },
        { $set: { stripeSubscriptionId: 'sub_never', status: 'ACTIVE' } },
      );

      const due = await subscriptions.findIdsToReconcile({
        staleBefore: new Date(NOW.getTime() - 12 * HOUR),
        lapsedSince: new Date(NOW.getTime() - 14 * DAY),
        limit: 10,
      });

      expect(due.map((entry) => entry.id)).toEqual([created.id]);
    });

    it('purges only the PENDING records with no provider subscription created before the cutoff', async () => {
      const dead = await pending({ openCheckoutKey: 'buyer:dead' });
      const fresh = await pending({ openCheckoutKey: 'buyer:fresh' });
      const paid = await inEffect(OFFICE);
      await model.collection.updateOne(
        { _id: new Types.ObjectId(dead.id) },
        { $set: { createdAt: new Date(NOW.getTime() - 4 * DAY) } },
      );
      await model.collection.updateOne(
        { _id: new Types.ObjectId(paid) },
        { $set: { createdAt: new Date(NOW.getTime() - 40 * DAY) } },
      );
      await model.collection.updateOne(
        { _id: new Types.ObjectId(fresh.id) },
        { $set: { createdAt: new Date(NOW.getTime() + 1 * DAY) } },
      );

      const purged = await subscriptions.purgeStalePending(new Date(NOW.getTime() - 3 * DAY));

      expect(purged).toBe(1);
      expect(await raw(dead.id)).toBeNull();
      expect(await raw(fresh.id)).not.toBeNull();
      expect(await raw(paid)).not.toBeNull();
    });
  });

  describe('SC-11: the same event id is processed by one delivery at a time', () => {
    const until = (from: Date) => new Date(from.getTime() + 2 * MINUTE);

    it('of 20 parallel claims on one event exactly one wins', async () => {
      await events.record('evt_1', 'invoice.paid', NOW);

      const claims = await Promise.all(
        Array.from({ length: 20 }, (_, n) =>
          events.claimProcessing('evt_1', `token-${n}`, NOW, until(NOW)),
        ),
      );

      expect(claims.filter(Boolean)).toHaveLength(1);
    });

    it('a live claim holds, an expired one (a holder that died) can be taken, a released one is free at once', async () => {
      await events.record('evt_1', 'invoice.paid', NOW);
      expect(await events.claimProcessing('evt_1', 'a', NOW, until(NOW))).toBe(true);

      expect(
        await events.claimProcessing('evt_1', 'b', new Date(NOW.getTime() + MINUTE), until(NOW)),
      ).toBe(false);
      const expired = until(NOW);
      expect(await events.claimProcessing('evt_1', 'b', expired, until(expired))).toBe(true);

      await events.releaseProcessing('evt_1', 'a'); // not the holder: changes nothing
      expect(await events.claimProcessing('evt_1', 'c', expired, until(expired))).toBe(false);
      await events.releaseProcessing('evt_1', 'b');
      expect(await events.claimProcessing('evt_1', 'c', expired, until(expired))).toBe(true);
    });

    it('a processed event cannot be claimed, and marking it processed drops the claim', async () => {
      await events.record('evt_1', 'invoice.paid', NOW);
      await events.claimProcessing('evt_1', 'a', NOW, until(NOW));

      await events.markProcessed('evt_1', NOW);

      expect(await eventModel.collection.findOne({ stripeEventId: 'evt_1' })).not.toHaveProperty(
        'processingToken',
      );
      expect(
        await events.claimProcessing('evt_1', 'b', new Date(NOW.getTime() + DAY), until(NOW)),
      ).toBe(false);
    });
  });

  describe('BR-012-29: two members cancelling at the same moment refund once (end to end)', () => {
    it('refunds once, ends the subscription, and neither cancel is an error', async () => {
      const clock = new FakeClock(NOW);
      const gateway = new FakePaymentGateway();
      const plans = new InMemoryPlans([PLAN]);
      const provisioner = new FakeOfficeProvisioner();
      const sync = new SubscriptionsService(
        subscriptions,
        events,
        plans as unknown as PlansService,
        gateway,
        clock,
        provisioner,
        new FakePaymentFailedNotifier(),
        testBusinessConfig(),
      );
      const slots = new JourneySlotsService(
        subscriptions,
        new FakeOwnerCounters() as unknown as OwnerCounterRepository,
      );
      const billing = new SubscriptionsBillingService(
        subscriptions,
        sync,
        plans as unknown as PlansService,
        new FakeCoupons() as unknown as CouponsService,
        slots,
        gateway,
        clock,
        provisioner,
        testBusinessConfig(),
        testConfigService({ FRONTEND_URL: 'https://app.example.test' }),
      );
      const created = await pending({ officeId: OFFICE });
      gateway.setSubscription(
        aProviderSubscription({
          id: 'sub_race',
          subscriptionRef: created.id,
          priceId: 'price_5',
          currentPeriodStart: NOW,
          currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY),
          latestInvoicePaidAt: NOW,
        }),
      );
      await sync.handleProviderEvent({
        id: 'evt_race',
        type: 'checkout.completed',
        subscriptionId: 'sub_race',
        subscriptionRef: created.id,
      });
      clock.advance(2 * DAY);
      const member = (id: string) =>
        anAccessContext(id, {
          memberships: [{ officeId: OFFICE }],
          officePlans: { [OFFICE]: WRITABLE },
        });
      const contexts = await Promise.all([member(BUYER), member(SECOND_MEMBER)]);

      const views = await Promise.all(contexts.map((ctx) => billing.cancel(ctx)));

      expect(gateway.refunds).toHaveLength(1);
      expect(gateway.refundRequests).toEqual([`refund:${created.id}`]);
      // A cancel that finds the refund recorded finishes the end too: it is idempotent at the
      // provider, so one or both may issue it, but it is the same subscription and the same end.
      expect([...new Set(gateway.cancelledSubscriptions)]).toEqual(['sub_race']);
      expect(views.some((view) => view.status === 'LAPSED')).toBe(true);
      expect(await raw(created.id)).toMatchObject({ status: 'LAPSED' });
      expect(await raw(created.id)).toHaveProperty('refundedAt');
    });
  });
});
