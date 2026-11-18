// SPEC-012 BR-012-07, BR-012-08, BR-012-13, BR-012-21, BR-012-28, TS-02: the real SubscriptionsService,
// repositories and OfficePlanSource over a real MongoDB, in the real AuthModule/AccessModule, with only
// the payment provider, the SPEC-011 office provisioner and the clock faked (TS-07, TS-06).
//
//  - the webhook against real concurrency (parallel deliveries of one event, of two events);
//  - the OFFICE_PLAN_SOURCE binding in AccessModule: the access context an account gets reflects
//    its office's subscription, the grace period and read-only, on every request.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AccessContextFactory } from '../../src/access/access-context.js';
import { MEMBERSHIP_SOURCE } from '../../src/access/sources/membership.source.js';
import { DomainError } from '../../src/common/errors/domain-error.js';
import { PaymentGateway, type PaymentEvent } from '../../src/payments/payment-gateway.js';
import { PlansService } from '../../src/plans/plans.service.js';
import { PlanEntity, type PlanDocument } from '../../src/plans/schemas/plan.schema.js';
import { Decimal } from '../../src/common/money/money.js';
import { OFFICE_PROVISIONER } from '../../src/subscriptions/ports/office-provisioner.js';
import { PAYMENT_FAILED_NOTIFIER } from '../../src/subscriptions/ports/payment-failed.notifier.js';
import {
  SubscriptionEntity,
  type SubscriptionDocument,
} from '../../src/subscriptions/schemas/subscription.schema.js';
import { SubscriptionOfficePlanSource } from '../../src/subscriptions/subscription-office-plan.source.js';
import { SubscriptionsRepository } from '../../src/subscriptions/subscriptions.repository.js';
import { SubscriptionsService } from '../../src/subscriptions/subscriptions.service.js';
import { aProviderSubscription } from '../builders/provider-subscription.builder.js';
import { DAY } from '../fakes/fake-clock.js';
import { FakeOfficeProvisioner } from '../fakes/fake-office-provisioner.js';
import { FakePaymentFailedNotifier } from '../fakes/fake-payment-failed-notifier.js';
import { FakePaymentGateway } from '../fakes/fake-payment-gateway.js';
import { AUTH_TEST_START, createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

const BUYER = '64b7f0000000000000000b01';
const MEMBER = '64b7f0000000000000000b02';
const OFFICE = '64b7f0000000000000000c01';
const OTHER_OFFICE = '64b7f0000000000000000c02';

const completed = (id: string, ref: string, subscriptionId = 'sub_1'): PaymentEvent => ({
  id,
  type: 'checkout.completed',
  subscriptionId,
  subscriptionRef: ref,
});
const changed = (id: string, subscriptionId = 'sub_1'): PaymentEvent => ({
  id,
  type: 'subscription.changed',
  subscriptionId,
});

describe('office subscriptions over MongoDB (integration, SPEC-012)', () => {
  const db = useTestDatabase();
  const gateway = new FakePaymentGateway();
  const provisioner = new FakeOfficeProvisioner();
  const notifier = new FakePaymentFailedNotifier();
  let harness: AuthTestApp;
  let service: SubscriptionsService;
  let repository: SubscriptionsRepository;
  let source: SubscriptionOfficePlanSource;
  let access: AccessContextFactory;
  let subscriptionModel: Model<SubscriptionDocument>;
  let planId = '';

  /** The plan state the access context holds for the member of this office, read fresh. */
  async function officeState(officeId = OFFICE) {
    const ctx = await access.forAccount({ userId: MEMBER, isAdmin: false });
    return ctx.memberships.find((membership) => membership.officeId === officeId);
  }
  const startCheckout = (officeId?: string) =>
    repository.createPending({
      buyerUserId: BUYER,
      planId,
      planCode: 'escritorio-5',
      activeJourneyLimit: 5,
      ...(officeId === undefined ? {} : { officeId }),
    });
  const providerHas = (
    ref: string,
    overrides: Parameters<typeof aProviderSubscription>[0] = {},
    id = 'sub_1',
  ) =>
    gateway.setSubscription(
      aProviderSubscription({ id, subscriptionRef: ref, priceId: 'price_5', ...overrides }),
    );

  beforeAll(async () => {
    harness = await createAuthTestApp(db, [], {}, (builder) =>
      builder
        .overrideProvider(PaymentGateway)
        .useValue(gateway)
        .overrideProvider(OFFICE_PROVISIONER)
        .useValue(provisioner)
        .overrideProvider(PAYMENT_FAILED_NOTIFIER)
        .useValue(notifier)
        // SPEC-011 is not built: a fake membership source puts MEMBER in OFFICE and OTHER_OFFICE.
        // OFFICE_PLAN_SOURCE is NOT overridden: the real binding of AccessModule is under test.
        .overrideProvider(MEMBERSHIP_SOURCE)
        .useValue({
          activeMemberships: (id: string) =>
            Promise.resolve(
              id === MEMBER ? [{ officeId: OFFICE }, { officeId: OTHER_OFFICE }] : [],
            ),
        }),
    );
    const get = <T>(token: new (...args: never[]) => T) =>
      harness.moduleRef.get(token, { strict: false });
    service = get(SubscriptionsService);
    repository = get(SubscriptionsRepository);
    source = get(SubscriptionOfficePlanSource);
    access = get(AccessContextFactory);
    subscriptionModel = harness.moduleRef.get(getModelToken(SubscriptionEntity.name));
    await subscriptionModel.syncIndexes(); // what migration 0006 builds in the deploy
    const planModel = harness.moduleRef.get<Model<PlanDocument>>(getModelToken(PlanEntity.name));
    await planModel.syncIndexes();
    const plans = get(PlansService);
    await plans.upsertCatalog([
      {
        code: 'escritorio-5',
        name: 'Escritório 5',
        price: new Decimal('199.90'),
        interval: 'month',
        activeJourneyLimit: 5,
        stripePriceId: 'price_5',
        status: 'OFFERED',
        sortOrder: 10,
      },
    ]);
    planId = (await plans.findByCode('escritorio-5'))?.id ?? '';
  });

  afterAll(async () => {
    await harness.app.close();
  });

  beforeEach(async () => {
    await subscriptionModel.collection.deleteMany({});
    await subscriptionModel.db.collection('paymentEvents').deleteMany({});
    provisioner.calls.length = 0;
    provisioner.offices.clear();
    notifier.notified.length = 0;
    harness.clock.set(AUTH_TEST_START);
  });

  describe('BR-012-13: the webhook under real concurrency', () => {
    it('five parallel deliveries of one activation event end with one office and one active subscription', async () => {
      const pending = await startCheckout();
      providerHas(pending.id);
      const event = completed('evt_race', pending.id);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.handleProviderEvent(event)),
      );

      // Some were refused while another held the lease (WEBHOOK_BUSY, the provider retries them).
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toEqual(new DomainError('WEBHOOK_BUSY'));
        }
      }
      expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
      // The retries.
      await service.handleProviderEvent(event);
      await service.handleProviderEvent(event);

      expect(await subscriptionModel.countDocuments()).toBe(1);
      expect(provisioner.offices.size).toBe(1);
      expect(await repository.findById(pending.id)).toMatchObject({
        status: 'ACTIVE',
        officeId: provisioner.offices.get(pending.id),
        syncLeaseToken: null,
      });
    });

    it('two different events for one subscription, in parallel, never lose the later provider state', async () => {
      const pending = await startCheckout(OFFICE);
      providerHas(pending.id);
      await service.handleProviderEvent(completed('evt_1', pending.id));
      // The provider's truth is now "ended"; two events about it race.
      providerHas(pending.id, {
        status: 'canceled',
        endedAt: new Date('2099-01-14T00:00:00.000Z'),
      });

      const results = await Promise.allSettled([
        service.handleProviderEvent(changed('evt_deleted')),
        service.handleProviderEvent(changed('evt_updated')),
      ]);
      // Redeliver whichever was refused.
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          await service.handleProviderEvent(changed(index === 0 ? 'evt_deleted' : 'evt_updated'));
        }
      }

      expect(await repository.findById(pending.id)).toMatchObject({
        status: 'LAPSED',
        lapsedAt: new Date('2099-01-14T00:00:00.000Z'),
        syncLeaseToken: null,
      });
    });

    it('a second paid subscription of an office is cancelled at the provider by the real unique index', async () => {
      const first = await startCheckout(OFFICE);
      providerHas(first.id);
      await service.handleProviderEvent(completed('evt_1', first.id));
      const second = await startCheckout(OFFICE);
      providerHas(second.id, {}, 'sub_2');

      await service.handleProviderEvent(completed('evt_2', second.id, 'sub_2'));

      expect(gateway.cancelledSubscriptions).toContain('sub_2');
      expect(await repository.findById(second.id)).toMatchObject({ status: 'LAPSED' });
      expect(await repository.findById(first.id)).toMatchObject({ status: 'ACTIVE' });
      expect(await subscriptionModel.countDocuments({ officeId: OFFICE, status: 'ACTIVE' })).toBe(
        1,
      );
    });
  });

  describe('BR-012-21, BR-012-28: the access context reads the office plan on every request', () => {
    async function activeOffice() {
      const pending = await startCheckout(OFFICE);
      providerHas(pending.id);
      await service.handleProviderEvent(completed(`evt_${pending.id}`, pending.id));
      return pending;
    }

    it('an office with a subscription in effect is an advisor office, writable', async () => {
      await activeOffice();

      expect(await officeState()).toMatchObject({
        officeId: OFFICE,
        advisorPlanActive: true,
        readOnly: false,
      });
    });

    it('BR-012-21: an office absent from the plan source (no subscription) is not an advisor office and is read-only', async () => {
      expect(await officeState(OTHER_OFFICE)).toMatchObject({
        advisorPlanActive: false,
        readOnly: true,
      });
    });

    it('an office with only a pending checkout has no plan (BR-012-09)', async () => {
      await startCheckout(OTHER_OFFICE);

      expect(await officeState(OTHER_OFFICE)).toMatchObject({
        advisorPlanActive: false,
        readOnly: true,
      });
    });

    it('BR-012-28: lapsed within the grace period it is writable on day 9; read-only at lapse + 10 days and on day 11', async () => {
      const active = await activeOffice();
      const lapse = harness.clock.now(); // the provider ends it "now"
      providerHas(active.id, { status: 'canceled', endedAt: lapse });
      await service.handleProviderEvent(changed('evt_ended'));

      expect(await repository.findById(active.id)).toMatchObject({
        status: 'LAPSED',
        lapsedAt: lapse,
      });
      expect(await officeState()).toMatchObject({ advisorPlanActive: true, readOnly: false });

      harness.clock.set(new Date(lapse.getTime() + 9 * DAY));
      expect(await officeState()).toMatchObject({ advisorPlanActive: true, readOnly: false });

      harness.clock.set(new Date(lapse.getTime() + 10 * DAY - 1));
      expect(await officeState()).toMatchObject({ readOnly: false });

      harness.clock.set(new Date(lapse.getTime() + 10 * DAY));
      expect(await officeState()).toMatchObject({ advisorPlanActive: true, readOnly: true });

      harness.clock.set(new Date(lapse.getTime() + 11 * DAY));
      expect(await officeState()).toMatchObject({ advisorPlanActive: true, readOnly: true });
    });

    it('BR-012-28: a new subscription in effect lifts read-only at once, beating the lapsed one', async () => {
      const old = await activeOffice();
      const lapse = harness.clock.now();
      providerHas(old.id, { status: 'canceled', endedAt: lapse });
      await service.handleProviderEvent(changed('evt_ended'));
      harness.clock.set(new Date(lapse.getTime() + 20 * DAY));
      expect(await officeState()).toMatchObject({ readOnly: true });

      const fresh = await startCheckout(OFFICE);
      providerHas(fresh.id, {}, 'sub_2');
      await service.handleProviderEvent(completed('evt_new', fresh.id, 'sub_2'));

      expect(await officeState()).toMatchObject({ advisorPlanActive: true, readOnly: false });
    });

    it('BR-012-28: the same subscription paying again (provider active) clears the lapse at once', async () => {
      const active = await activeOffice();
      providerHas(active.id, { status: 'unpaid' });
      await service.handleProviderEvent(changed('evt_unpaid'));
      harness.clock.set(new Date(AUTH_TEST_START.getTime() + 30 * DAY));
      expect(await officeState()).toMatchObject({ readOnly: true });

      providerHas(active.id, { status: 'active' });
      await service.handleProviderEvent({
        id: 'evt_paid',
        type: 'invoice.paid',
        subscriptionId: 'sub_1',
      });

      expect(await officeState()).toMatchObject({ readOnly: false });
      expect(await repository.findById(active.id)).toMatchObject({
        status: 'ACTIVE',
        lapsedAt: null,
      });
    });

    it('answers every office asked for in one call, and unknown ones are simply absent (fail closed)', async () => {
      await activeOffice();

      const plans = await source.officePlans([OFFICE, OTHER_OFFICE, 'not-an-id']);

      expect([...plans.keys()]).toEqual([OFFICE]);
    });

    it('BR-012-27: a subscription gives a self-advised investor no entitlement', async () => {
      await activeOffice();

      expect(await source.selfAdvisedEntitlements()).toEqual([]);
    });
  });

  describe('BR-012-20: a failed renewal, end to end', () => {
    it('moves to PAST_DUE keeping the limit, and tells the office once even if the event is delivered twice', async () => {
      const pending = await startCheckout(OFFICE);
      providerHas(pending.id, { status: 'past_due' });
      const failed: PaymentEvent = {
        id: 'evt_failed',
        type: 'invoice.payment_failed',
        subscriptionId: 'sub_1',
      };

      await service.handleProviderEvent(failed);
      await service.handleProviderEvent(failed);

      expect(await repository.findById(pending.id)).toMatchObject({
        status: 'PAST_DUE',
        activeJourneyLimit: 5,
      });
      expect(notifier.notified).toEqual([OFFICE]);
      expect(await officeState()).toMatchObject({ advisorPlanActive: true, readOnly: false });
    });
  });
});
