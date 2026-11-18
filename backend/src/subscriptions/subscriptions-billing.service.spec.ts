// SPEC-012 BR-012-06..BR-012-11, BR-012-16..BR-012-19, BR-012-29: what a member of an office does
// with its plan, against hand-written fakes of every port (TS-03, TS-07): the payment provider,
// the subscription store, the plan catalog, the coupons, the journey counters and SPEC-011's
// office provisioner. The real conditional updates these fakes imitate (the open-checkout key, the
// refund claim) are proven against MongoDB in test/integration/subscriptions-billing.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '../access/access-context.js';
import type { OwnerCounterRepository } from '../access/owner-counter.repository.js';
import type { OfficePlanState } from '../access/sources/office-plan.source.js';
import { DomainError } from '../common/errors/domain-error.js';
import { Decimal } from '../common/money/money.js';
import type { ProviderInvoice } from '../payments/payment-gateway.js';
import type { CouponsService } from '../coupons/coupons.service.js';
import type { PlansService } from '../plans/plans.service.js';
import { aPlan } from '../../test/builders/plan.builder.js';
import { aProviderSubscription } from '../../test/builders/provider-subscription.builder.js';
import { anAccessContext } from '../../test/fakes/fake-access-sources.js';
import { DAY, FakeClock, MINUTE } from '../../test/fakes/fake-clock.js';
import { FakeCoupons } from '../../test/fakes/fake-coupons.js';
import { FakeOfficeProvisioner } from '../../test/fakes/fake-office-provisioner.js';
import { FakeOwnerCounters } from '../../test/fakes/fake-owner-counters.js';
import { FakePaymentEventsRepository } from '../../test/fakes/fake-payment-events-repository.js';
import { FakePaymentFailedNotifier } from '../../test/fakes/fake-payment-failed-notifier.js';
import { FakePaymentGateway } from '../../test/fakes/fake-payment-gateway.js';
import { FakeSubscriptionsRepository } from '../../test/fakes/fake-subscriptions-repository.js';
import { InMemoryPlans } from '../../test/fakes/in-memory-plans.js';
import { expectNoneLogged, spyOnLogger } from '../../test/support/logger-spy.js';
import { testBusinessConfig, testConfigService } from '../../test/support/test-env.js';
import { JourneySlotsService, ACTIVE_JOURNEYS_KEY } from './journey-slots.service.js';
import type { PaymentEventsRepository } from './payment-events.repository.js';
import {
  INVOICE_CACHE_MS,
  REFUND_CLAIM_STALE_MS,
  SubscriptionsBillingService,
} from './subscriptions-billing.service.js';
import type { SubscriptionsRepository } from './subscriptions.repository.js';
import { SubscriptionsService } from './subscriptions.service.js';

const FIRST_PAID = new Date('2026-03-01T12:00:00.000Z');
const BUYER = '64b7f0000000000000000b01';
const SECOND_MEMBER = '64b7f0000000000000000b02';
const OFFICE = '64b7f0000000000000000c01';
const OTHER_OFFICE = '64b7f0000000000000000c02';
const WRITABLE: OfficePlanState = {
  advisorPlanActive: true,
  readOnly: false,
  entitlements: ['advisor'],
};
const READ_ONLY: OfficePlanState = { ...WRITABLE, readOnly: true };

const PLAN_5 = aPlan({
  id: '64b7f0000000000000000a05',
  code: 'escritorio-5',
  name: 'Escritório 5',
  activeJourneyLimit: 5,
  stripePriceId: 'price_5',
});
const PLAN_2 = aPlan({
  id: '64b7f0000000000000000a02',
  code: 'escritorio-2',
  name: 'Escritório 2',
  price: new Decimal('99.90'),
  activeJourneyLimit: 2,
  stripePriceId: 'price_2',
});
const PLAN_10 = aPlan({
  id: '64b7f0000000000000000a10',
  code: 'escritorio-10',
  name: 'Escritório 10',
  price: new Decimal('349.90'),
  activeJourneyLimit: 10,
  stripePriceId: 'price_10',
});
const PLAN_5_YEARLY = aPlan({
  id: '64b7f0000000000000000a15',
  code: 'escritorio-5-anual',
  interval: 'year',
  activeJourneyLimit: 5,
  stripePriceId: 'price_5y',
});
const PLAN_OLD = aPlan({
  id: '64b7f0000000000000000a09',
  code: 'escritorio-antigo',
  activeJourneyLimit: 3,
  stripePriceId: 'price_old',
  status: 'WITHDRAWN',
});

function build(env: Record<string, string | undefined> = {}) {
  const clock = new FakeClock(FIRST_PAID);
  const gateway = new FakePaymentGateway();
  const subscriptions = new FakeSubscriptionsRepository(() => clock.now());
  const plans = new InMemoryPlans([PLAN_5, PLAN_2, PLAN_10, PLAN_5_YEARLY, PLAN_OLD]);
  const provisioner = new FakeOfficeProvisioner();
  const counters = new FakeOwnerCounters();
  const coupons = new FakeCoupons();
  // The provider sells every plan of the catalog (the change checks the price is still active).
  for (const plan of [PLAN_5, PLAN_2, PLAN_10, PLAN_5_YEARLY, PLAN_OLD]) gateway.listsPlan(plan);
  const sync = new SubscriptionsService(
    subscriptions as unknown as SubscriptionsRepository,
    new FakePaymentEventsRepository() as unknown as PaymentEventsRepository,
    plans as unknown as PlansService,
    gateway,
    clock,
    provisioner,
    new FakePaymentFailedNotifier(),
    testBusinessConfig(),
  );
  const slots = new JourneySlotsService(
    subscriptions as unknown as SubscriptionsRepository,
    counters as unknown as OwnerCounterRepository,
  );
  const billing = new SubscriptionsBillingService(
    subscriptions as unknown as SubscriptionsRepository,
    sync,
    plans as unknown as PlansService,
    coupons as unknown as CouponsService,
    slots,
    gateway,
    clock,
    provisioner,
    testBusinessConfig(),
    testConfigService({
      FRONTEND_URL: 'https://app.example.test',
      STRIPE_BILLING_PORTAL_CONFIGURATION_ID: 'bpc_test_1',
      ...env,
    }),
  );

  let sequence = 0;
  /**
   * An office with a subscription the provider confirmed (the webhook path of PR1): a PENDING
   * record of the office, the provider's subscription carrying its ref, and the checkout event.
   */
  async function subscribeOffice(
    officeId: string,
    options: {
      plan?: typeof PLAN_5;
      overrides?: Parameters<typeof aProviderSubscription>[0];
    } = {},
  ): Promise<{ ref: string; providerId: string }> {
    sequence += 1;
    const plan = options.plan ?? PLAN_5;
    const providerId = `sub_${sequence}`;
    const pending = await subscriptions.createPending({
      buyerUserId: BUYER,
      planId: plan.id,
      planCode: plan.code,
      activeJourneyLimit: plan.activeJourneyLimit,
      officeId,
      checkoutSessionId: `cs_seed_${sequence}`,
    });
    gateway.setSubscription(
      aProviderSubscription({
        id: providerId,
        customerId: 'cus_office_1',
        subscriptionRef: pending.id,
        priceId: plan.stripePriceId,
        currentPeriodStart: clock.now(),
        currentPeriodEnd: new Date(clock.now().getTime() + 30 * DAY),
        firstInvoicePaidAt: clock.now(),
        ...options.overrides,
      }),
    );
    await sync.handleProviderEvent({
      id: `evt_seed_${sequence}`,
      type: 'checkout.completed',
      subscriptionId: providerId,
      subscriptionRef: pending.id,
    });
    return { ref: pending.id, providerId };
  }

  const memberOf = (
    accountId = BUYER,
    officeId = OFFICE,
    plan: OfficePlanState = WRITABLE,
  ): Promise<AccessContext> =>
    anAccessContext(accountId, { memberships: [{ officeId }], officePlans: { [officeId]: plan } });
  const noOffice = (accountId = BUYER, isAdmin = false): Promise<AccessContext> =>
    anAccessContext(accountId, {}, isAdmin);

  return {
    clock,
    gateway,
    subscriptions,
    plans,
    provisioner,
    counters,
    coupons,
    sync,
    billing,
    subscribeOffice,
    memberOf,
    noOffice,
  };
}

type Harness = ReturnType<typeof build>;

const BUYER_INFO = { email: 'ana.teste@example.test', name: 'Ana Teste' };

const anInvoice = (id: string): ProviderInvoice => ({
  id,
  reason: 'subscription_cycle',
  periodStart: FIRST_PAID,
  periodEnd: new Date(FIRST_PAID.getTime() + 30 * DAY),
  paidAt: FIRST_PAID,
  amount: new Decimal('199.9'),
  status: 'paid',
  hostedUrl: `https://invoice.example.test/${id}`,
});

describe('SubscriptionsBillingService (SPEC-012 office billing)', () => {
  let t: Harness;

  beforeEach(() => {
    t = build();
  });

  describe('BR-012-09, BR-012-10: checkout', () => {
    it('BR-012-10: starts the hosted Checkout with our ref on the session AND the subscription, and stores the session id', async () => {
      const ctx = await t.noOffice();

      const { url } = await t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code });

      const [checkout] = t.gateway.checkouts;
      const [pending] = [...t.subscriptions.rows.values()];
      expect(url).toBe('https://checkout.example.test/cs_fake_1');
      expect(checkout).toMatchObject({
        priceId: 'price_5',
        subscriptionRef: pending?.id,
        successUrl: `https://app.example.test/plans/success?ref=${pending?.id}`,
        cancelUrl: 'https://app.example.test/plans/cancel',
        idempotencyKey: `checkout:${pending?.id}`,
      });
      // ADR-005: the record names the session the moment it exists.
      expect(pending).toMatchObject({
        status: 'PENDING',
        checkoutSessionId: 'cs_fake_1',
        stripeCustomerId: 'cus_fake_1',
        buyerUserId: BUYER,
        planCode: PLAN_5.code,
        activeJourneyLimit: 5,
        officeId: null,
      });
      expect(t.gateway.customers).toEqual([
        { ...BUYER_INFO, userId: BUYER, idempotencyKey: `customer:${BUYER}` },
      ]);
      expect(checkout?.expiresAt.getTime()).toBe(FIRST_PAID.getTime() + 60 * MINUTE);
    });

    it('BR-012-09: the checkout grants nothing: no office, no limit, no state change', async () => {
      await t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code });

      const [pending] = [...t.subscriptions.rows.values()];
      expect(pending?.status).toBe('PENDING');
      expect(t.provisioner.calls).toEqual([]);
    });

    it('BR-012-04: only an offered plan can be subscribed to', async () => {
      const ctx = await t.noOffice();

      for (const planCode of [PLAN_OLD.code, 'nope']) {
        await expect(t.billing.checkout(ctx, BUYER_INFO, { planCode })).rejects.toMatchObject({
          code: 'INVALID_PLAN',
        });
      }
      expect(t.subscriptions.rows.size).toBe(0);
    });

    it('BR-026-08: a valid coupon applies to the new subscription through its promotion code', async () => {
      t.coupons.add('DESCONTO', { stripePromotionCodeId: 'promo_desconto' });

      await t.billing.checkout(await t.noOffice(), BUYER_INFO, {
        planCode: PLAN_5.code,
        couponCode: 'desconto',
      });

      expect(t.gateway.checkouts[0]?.promotionCodeId).toBe('promo_desconto');
    });

    it('an invalid coupon is refused and nothing is created', async () => {
      await expect(
        t.billing.checkout(await t.noOffice(), BUYER_INFO, {
          planCode: PLAN_5.code,
          couponCode: 'NOPE',
        }),
      ).rejects.toMatchObject({ code: 'COUPON_INVALID' });
      t.coupons.add('SEMPROMO', { stripePromotionCodeId: null });
      await expect(
        t.billing.checkout(await t.noOffice(), BUYER_INFO, {
          planCode: PLAN_5.code,
          couponCode: 'SEMPROMO',
        }),
      ).rejects.toMatchObject({ code: 'COUPON_INVALID' });
      expect(t.subscriptions.rows.size).toBe(0);
      expect(t.gateway.customers).toEqual([]);
    });

    it('BR-012-07: an account with no office cannot buy while SPEC-011 cannot create one: nothing is charged', async () => {
      t.provisioner.available = false;

      await expect(
        t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'OFFICE_CREATION_UNAVAILABLE' });

      expect(t.subscriptions.rows.size).toBe(0);
      expect(t.gateway.customers).toEqual([]);
      expect(t.gateway.checkouts).toEqual([]);
    });

    it('BR-002-21: an admin has no office to buy for and never becomes one', async () => {
      await expect(
        t.billing.checkout(await t.noOffice(BUYER, true), BUYER_INFO, { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('BR-012-08: an office with a subscription in effect cannot start another checkout', async () => {
      await t.subscribeOffice(OFFICE);

      await expect(
        t.billing.checkout(await t.memberOf(), BUYER_INFO, { planCode: PLAN_2.code }),
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_ALREADY_ACTIVE' });
    });

    it('BR-012-21: a lapsed office subscribes again for itself, reusing its provider customer', async () => {
      const { providerId } = await t.subscribeOffice(OFFICE);
      t.gateway.setSubscription({ ...t.gateway.current(providerId), status: 'canceled' });
      await t.sync.refresh([...t.subscriptions.rows.keys()][0] ?? '');
      t.gateway.customers.length = 0;

      await t.billing.checkout(await t.memberOf(), BUYER_INFO, { planCode: PLAN_2.code });

      const rows = [...t.subscriptions.rows.values()];
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ status: 'PENDING', officeId: OFFICE });
      expect(t.gateway.checkouts[0]?.customerId).toBe('cus_office_1');
      expect(t.gateway.customers).toEqual([]);
    });

    it('BR-011-aside / AR-14: an office the caller is not a member of is the same NOT_FOUND as a missing one', async () => {
      await t.subscribeOffice(OTHER_OFFICE);
      const ctx = await t.memberOf();

      const foreign = await t.billing
        .checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code, officeId: OTHER_OFFICE })
        .catch((error: unknown) => error);
      const missing = await t.billing
        .checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code, officeId: '64b7f00000000000000fffff' })
        .catch((error: unknown) => error);

      expect(foreign).toEqual(missing);
      expect((foreign as DomainError).code).toBe('NOT_FOUND');
    });

    it('BR-002-11: a member of several offices must say which one', async () => {
      const ctx = await anAccessContext(BUYER, {
        memberships: [{ officeId: OFFICE }, { officeId: OTHER_OFFICE }],
        officePlans: { [OFFICE]: WRITABLE, [OTHER_OFFICE]: WRITABLE },
      });

      await expect(
        t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', context: { fields: ['officeId'] } });
    });

    it('acceptance: a checkout that fails at the provider leaves no record behind', async () => {
      t.gateway.failCheckout = true;

      await expect(
        t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'CHECKOUT_SESSION_FAILED' });

      expect(t.subscriptions.rows.size).toBe(0);
      expect(t.subscriptions.openKeys.size).toBe(0);
      // And the buyer can try again at once.
      t.gateway.failCheckout = false;
      await t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code });
    });

    it('acceptance: a session that cannot be stored is expired and the record removed', async () => {
      const originalSet = t.subscriptions.setCheckoutSession.bind(t.subscriptions);
      t.subscriptions.setCheckoutSession = async () => false;

      await expect(
        t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'CHECKOUT_SESSION_FAILED' });

      expect(t.gateway.expiredSessions).toEqual(['cs_fake_1']);
      expect(t.subscriptions.rows.size).toBe(0);
      t.subscriptions.setCheckoutSession = originalSet;
    });

    it('BR-012-07: ONE open checkout per buyer: a new attempt expires the abandoned session and replaces it', async () => {
      const ctx = await t.noOffice();
      await t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code });

      await t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_2.code });

      expect(t.gateway.expiredSessions).toEqual(['cs_fake_1']);
      const rows = [...t.subscriptions.rows.values()];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ planCode: PLAN_2.code, checkoutSessionId: 'cs_fake_2' });
    });

    it('BR-012-07: a session the buyer already paid is not replaced: the payment is being confirmed', async () => {
      const ctx = await t.noOffice();
      await t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code });
      t.gateway.completedSessions.add('cs_fake_1');

      await expect(
        t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'CHECKOUT_IN_PROGRESS' });

      expect(t.subscriptions.rows.size).toBe(1);
    });

    it('BR-012-07: a checkout the provider already made a subscription of is never replaced', async () => {
      const ctx = await t.noOffice();
      await t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code });
      const [pending] = [...t.subscriptions.rows.values()];
      // The provider reports the subscription still unpaid (incomplete → PENDING).
      t.gateway.setSubscription(
        aProviderSubscription({
          id: 'sub_inc',
          status: 'incomplete',
          subscriptionRef: pending?.id ?? '',
          priceId: 'price_5',
        }),
      );
      await t.sync.handleProviderEvent({
        id: 'evt_inc',
        type: 'subscription.changed',
        subscriptionId: 'sub_inc',
      });

      await expect(
        t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'CHECKOUT_IN_PROGRESS' });
    });

    it('BR-012-07: a record whose session was never stored is waited for, then removed as an orphan', async () => {
      const ctx = await t.noOffice();
      await t.subscriptions.createPending({
        buyerUserId: BUYER,
        planId: PLAN_5.id,
        planCode: PLAN_5.code,
        activeJourneyLimit: 5,
        openCheckoutKey: `buyer:${BUYER}`,
      });

      await expect(
        t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'CHECKOUT_IN_PROGRESS' });
      t.clock.advance(5 * MINUTE);
      await t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code });

      expect(t.subscriptions.rows.size).toBe(1);
    });

    it('BR-012-07: two checkouts of one buyer at the same moment start only one', async () => {
      const ctx = await t.noOffice();

      const results = await Promise.allSettled([
        t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code }),
        t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code }),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((result) => result.status === 'rejected');
      expect((refused as PromiseRejectedResult).reason).toMatchObject({
        code: 'CHECKOUT_IN_PROGRESS',
      });
      expect(t.subscriptions.rows.size).toBe(1);
    });

    it('BR-012-14: a read-only context (a support grant view) never starts a checkout', async () => {
      const ctx = await t.noOffice();
      const readOnly = Object.create(ctx, { readOnly: { value: true } }) as AccessContext;

      await expect(
        t.billing.checkout(readOnly, BUYER_INFO, { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('BR-012-09: the success page', () => {
    it('shows PENDING until the provider confirmed AND the office exists, then CONFIRMED', async () => {
      const ctx = await t.noOffice();
      await t.billing.checkout(ctx, BUYER_INFO, { planCode: PLAN_5.code });
      const [pending] = [...t.subscriptions.rows.values()];
      const ref = pending?.id ?? '';

      expect(await t.billing.checkoutState(ctx, ref)).toBe('PENDING');

      t.gateway.setSubscription(
        aProviderSubscription({ id: 'sub_1', subscriptionRef: ref, priceId: 'price_5' }),
      );
      await t.sync.handleProviderEvent({
        id: 'evt_1',
        type: 'checkout.completed',
        subscriptionId: 'sub_1',
        subscriptionRef: ref,
      });
      expect(await t.billing.checkoutState(ctx, ref)).toBe('CONFIRMED');
    });

    it('AR-14: another account asking for this ref gets the same NOT_FOUND as a ref that does not exist', async () => {
      await t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code });
      const [pending] = [...t.subscriptions.rows.values()];
      const stranger = await t.noOffice(SECOND_MEMBER);

      const foreign = await t.billing
        .checkoutState(stranger, pending?.id ?? '')
        .catch((error: unknown) => error);
      const missing = await t.billing
        .checkoutState(stranger, '64b7f00000000000000fffff')
        .catch((error: unknown) => error);
      const malformed = await t.billing
        .checkoutState(stranger, 'not-an-id')
        .catch((error: unknown) => error);

      expect(foreign).toEqual(missing);
      expect(malformed).toEqual(missing);
      expect((foreign as DomainError).code).toBe('NOT_FOUND');
    });
  });

  describe('BR-012-11, BR-012-26: reading the plan', () => {
    it('shows the plan, the limit, the count against it, the dates and the settings it words', async () => {
      await t.subscribeOffice(OFFICE);
      t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 4);

      const view = await t.billing.view(await t.memberOf());

      expect(view).toMatchObject({
        officeId: OFFICE,
        plan: { code: 'escritorio-5', name: 'Escritório 5', interval: 'month' },
        status: 'ACTIVE',
        activeJourneyLimit: 5,
        inProgress: 4,
        cancelAtPeriodEnd: false,
        scheduledChange: null,
        lapsedAt: null,
        readOnlyAt: null,
        firstPaidAt: FIRST_PAID,
        canUndoScheduledChange: false,
        canUndoCancel: false,
        refundWindowDays: 7,
        graceDays: 10,
      });
      expect(view.plan.price.toFixed(2)).toBe('199.90');
      expect(view.nextChargeAmount?.toFixed(2)).toBe('199.90');
      expect(view.currentPeriodEnd?.toISOString()).toBe('2026-03-31T12:00:00.000Z');
      // The history has its own route: the plan page never waits for the provider's invoice list.
      expect(t.gateway.invoiceReads).toBe(0);
    });

    it('BR-012-17: a scheduled downgrade names its price, and the next charge is the new plan price; it can be undone', async () => {
      const { ref } = await t.subscribeOffice(OFFICE);
      const ctx = await t.memberOf();
      await t.billing.changePlan(ctx, { planCode: PLAN_2.code });

      const view = await t.billing.view(ctx);

      expect(view.scheduledChange).toMatchObject({ planCode: PLAN_2.code, interval: 'month' });
      expect(view.scheduledChange?.price.toFixed(2)).toBe('99.90');
      expect(view.nextChargeAmount?.toFixed(2)).toBe('99.90');
      expect(view.canUndoScheduledChange).toBe(true);
      expect(t.subscriptions.get(ref).scheduledPlanId).toBe(PLAN_2.id);
    });

    it('BR-012-19: while cancelling nothing renews, and the cancellation can be undone', async () => {
      await t.subscribeOffice(OFFICE);
      const ctx = await t.memberOf();
      t.clock.advance(10 * DAY); // past the refund window: a cancel stops renewal only
      await t.billing.cancel(ctx);

      const view = await t.billing.view(ctx);

      expect(view).toMatchObject({
        status: 'CANCELING',
        canUndoCancel: true,
        nextChargeAmount: null,
      });
    });

    it('BR-012-11: ANY member sees it, not only the one who paid', async () => {
      await t.subscribeOffice(OFFICE);

      const view = await t.billing.view(await t.memberOf(SECOND_MEMBER));

      expect(view.status).toBe('ACTIVE');
    });

    it('BR-012-11, AR-35: the billing history is paged from one bounded read, newest first', async () => {
      await t.subscribeOffice(OFFICE);
      t.gateway.invoices = Array.from({ length: 14 }, (_, index) => anInvoice(`in_${index + 1}`));
      const ctx = await t.memberOf();

      const first = await t.billing.invoices(ctx, undefined, { page: 1, pageSize: 6 });
      const last = await t.billing.invoices(ctx, undefined, { page: 3, pageSize: 6 });
      const beyond = await t.billing.invoices(ctx, undefined, { page: 9, pageSize: 6 });

      expect(first.items.map((invoice) => invoice.id)).toEqual([
        'in_1',
        'in_2',
        'in_3',
        'in_4',
        'in_5',
        'in_6',
      ]);
      expect([first.total, first.page, first.pageSize]).toEqual([14, 1, 6]);
      expect(last.items.map((invoice) => invoice.id)).toEqual(['in_13', 'in_14']);
      expect(beyond.items).toEqual([]);
      expect(beyond.total).toBe(14);
      // three pages, one provider read (30 s cache), and it asked for the newest 100 only
      expect(t.gateway.invoiceReads).toBe(1);
    });

    it('BR-012-11: ANY member pages the history; a stranger gets the shared NOT_FOUND', async () => {
      await t.subscribeOffice(OFFICE);
      t.gateway.invoices = [anInvoice('in_1')];

      const colleague = await t.billing.invoices(await t.memberOf(SECOND_MEMBER), undefined, {
        page: 1,
        pageSize: 6,
      });
      const stranger = await t.billing
        .invoices(await t.noOffice(), OFFICE, { page: 1, pageSize: 6 })
        .catch((error: unknown) => error);

      expect(colleague.items).toHaveLength(1);
      expect(stranger).toBeInstanceOf(DomainError);
    });

    it('an office with no provider customer yet has an empty history, not an error', async () => {
      const ctx = await t.memberOf();

      await expect(t.billing.invoices(ctx, undefined, { page: 1, pageSize: 6 })).resolves.toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 6,
      });
      expect(t.gateway.invoiceReads).toBe(0);
    });

    it('a billing history the provider cannot give is BILLING_HISTORY_UNAVAILABLE, and the plan page still works', async () => {
      await t.subscribeOffice(OFFICE);
      t.gateway.failInvoices = true;
      const ctx = await t.memberOf();

      await expect(
        t.billing.invoices(ctx, undefined, { page: 1, pageSize: 6 }),
      ).rejects.toMatchObject({
        code: 'BILLING_HISTORY_UNAVAILABLE',
      });
      expect((await t.billing.view(ctx)).status).toBe('ACTIVE');
    });

    it('AR-14: a removed member and a stranger get the same NOT_FOUND as a missing office', async () => {
      await t.subscribeOffice(OFFICE);
      const removed = await t.noOffice(); // was a member; memberships are read fresh (BR-002-15)
      const attempts = ['64b7f00000000000000fffff', OFFICE].map((officeId) =>
        t.billing.view(removed, officeId).catch((error: unknown) => error),
      );

      const [missing, ownOffice] = await Promise.all(attempts);

      expect(ownOffice).toEqual(missing);
      expect((missing as DomainError).code).toBe('NOT_FOUND');
    });

    it('BR-002-11: a member of office A cannot read office B by naming it', async () => {
      await t.subscribeOffice(OTHER_OFFICE);

      await expect(t.billing.view(await t.memberOf(), OTHER_OFFICE)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('an office that never paid has no plan to show', async () => {
      await expect(t.billing.view(await t.memberOf())).rejects.toMatchObject({
        code: 'SUBSCRIPTION_NOT_FOUND',
      });
    });

    it('BR-012-27: a self-advised account has no office plan', async () => {
      const ctx = await anAccessContext(BUYER, { selfAdvised: true });

      await expect(t.billing.view(ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('BR-012-28: a lapsed office sees its lapse, the date it turns read-only and a zero limit', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      t.clock.advance(40 * DAY);
      t.gateway.setSubscription({ ...t.gateway.current(providerId), status: 'canceled' });
      await t.sync.refresh(ref);

      const view = await t.billing.view(await t.memberOf(BUYER, OFFICE, READ_ONLY));

      expect(view.status).toBe('LAPSED');
      expect(view.activeJourneyLimit).toBe(0);
      expect(view.lapsedAt?.toISOString()).toBe('2026-04-10T12:00:00.000Z');
      // 2026-04-10T12:00Z + 10 days of grace
      expect(view.readOnlyAt?.toISOString()).toBe('2026-04-20T12:00:00.000Z');
      expect(view.refundEligibleUntil).toBeNull();
    });

    it('BR-012-29: shows until when cancelling refunds in full, for the first subscription only', async () => {
      await t.subscribeOffice(OFFICE);

      const view = await t.billing.view(await t.memberOf());

      expect(view.refundEligibleUntil?.toISOString()).toBe('2026-03-08T12:00:00.000Z');
    });
  });

  describe('BR-012-16: upgrade', () => {
    it('BR-012-16: asks the provider for the prorated upgrade and changes NOTHING locally until it is paid', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);

      const view = await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code });

      expect(t.gateway.priceChanges).toEqual([
        expect.objectContaining({ subscriptionId: providerId, priceId: 'price_10' }),
      ]);
      // The provider has not billed the new price yet: plan and limit are what they were.
      expect(view.plan.code).toBe('escritorio-5');
      expect(view.activeJourneyLimit).toBe(5);
      expect(t.subscriptions.get(ref)).toMatchObject({
        planCode: 'escritorio-5',
        activeJourneyLimit: 5,
      });
    });

    it('BR-012-16: the new limit applies from the moment the provider reports the new paid price', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code });

      t.gateway.payPendingChange(providerId); // the prorated invoice was paid
      const refreshed = await t.sync.refresh(ref);

      expect(refreshed).toMatchObject({ planCode: 'escritorio-10', activeJourneyLimit: 10 });
    });

    it('BR-012-16: an upgrade the provider applies at once (paid) is visible in the answer', async () => {
      await t.subscribeOffice(OFFICE);
      t.gateway.payUpgradesAtOnce = true;

      const view = await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code });

      expect(view).toMatchObject({ activeJourneyLimit: 10, plan: { code: 'escritorio-10' } });
    });

    it('BR-012-17: an upgrade drops a downgrade that was scheduled first', async () => {
      const { providerId } = await t.subscribeOffice(OFFICE);
      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code });

      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code });

      expect(t.gateway.releasedSchedules).toEqual([providerId]);
      expect(t.gateway.priceChanges).toHaveLength(1);
    });
  });

  describe('BR-012-16, BR-012-17: previewing a change (read only)', () => {
    it('BR-012-16: an upgrade answers the provider own prorated amount and changes nothing', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      t.gateway.preview = {
        amountDue: new Decimal('12600.09'),
        currency: 'brl',
        lines: [{ amount: new Decimal('12990') }, { amount: new Decimal('-389.91') }],
        nextChargeAt: new Date('2027-03-01T12:00:00.000Z'),
      };
      const before = { ...t.subscriptions.get(ref) };

      const preview = await t.billing.previewChange(await t.memberOf(), {
        planCode: PLAN_10.code,
      });

      expect(preview).toMatchObject({ change: 'upgrade', currency: 'BRL', effectiveAt: null });
      expect(preview.amountDue.toFixed(2)).toBe('12600.09');
      expect(preview.lines.map((line) => line.amount.toFixed(2))).toEqual(['12990.00', '-389.91']);
      expect(preview.nextChargeAt?.toISOString()).toBe('2027-03-01T12:00:00.000Z');
      expect(preview.nextChargeAmount.toFixed(2)).toBe('349.90');
      expect(t.gateway.previewRequests).toEqual([
        { subscriptionId: providerId, priceId: 'price_10' },
      ]);
      // read only: no price change, no schedule, no write
      expect(t.gateway.callLog).toEqual([]);
      expect(t.subscriptions.get(ref)).toEqual(before);
    });

    it('an upgrade whose preview carries no next charge date falls back to the period end', async () => {
      await t.subscribeOffice(OFFICE);
      t.gateway.preview = { ...t.gateway.preview, nextChargeAt: null };

      const preview = await t.billing.previewChange(await t.memberOf(), {
        planCode: PLAN_10.code,
      });

      expect(preview.nextChargeAt?.toISOString()).toBe('2026-03-31T12:00:00.000Z');
    });

    it('BR-012-17: a downgrade charges nothing now and names the period end, without asking the provider', async () => {
      await t.subscribeOffice(OFFICE);

      const preview = await t.billing.previewChange(await t.memberOf(), { planCode: PLAN_2.code });

      expect(preview.change).toBe('schedule');
      expect(preview.amountDue.isZero()).toBe(true);
      expect(preview.effectiveAt?.toISOString()).toBe('2026-03-31T12:00:00.000Z');
      expect(preview.nextChargeAmount.toFixed(2)).toBe('99.90');
      expect(t.gateway.previewRequests).toEqual([]);
    });

    it('choosing the plan in effect, or the one scheduled, changes nothing; with a schedule it releases it', async () => {
      await t.subscribeOffice(OFFICE);
      const ctx = await t.memberOf();
      expect((await t.billing.previewChange(ctx, { planCode: PLAN_5.code })).change).toBe('keep');

      await t.billing.changePlan(ctx, { planCode: PLAN_2.code });

      const released = await t.billing.previewChange(ctx, { planCode: PLAN_5.code });
      expect(released).toMatchObject({ change: 'release_schedule', effectiveAt: null });
      expect(released.nextChargeAmount.toFixed(2)).toBe('199.90');
      expect((await t.billing.previewChange(ctx, { planCode: PLAN_2.code })).change).toBe('keep');
    });

    it('refuses what the change refuses: nothing in effect, a withdrawn or unknown plan, a cancelling subscription, a read-only context', async () => {
      const ctx = await t.memberOf();
      await expect(t.billing.previewChange(ctx, { planCode: PLAN_10.code })).rejects.toMatchObject({
        code: 'SUBSCRIPTION_NOT_CHANGEABLE',
      });
      await t.subscribeOffice(OFFICE);
      for (const planCode of [PLAN_OLD.code, 'nope']) {
        await expect(t.billing.previewChange(ctx, { planCode })).rejects.toMatchObject({
          code: 'INVALID_PLAN',
        });
      }
      await expect(
        t.billing.previewChange({ ...ctx, readOnly: true } as AccessContext, {
          planCode: PLAN_10.code,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      t.clock.advance(10 * DAY);
      await t.billing.cancel(ctx);
      await expect(t.billing.previewChange(ctx, { planCode: PLAN_10.code })).rejects.toMatchObject({
        code: 'SUBSCRIPTION_NOT_CHANGEABLE',
      });
      expect((await t.billing.previewChange(ctx, { planCode: PLAN_5.code })).change).toBe('keep');
    });

    it('a price the provider no longer sells is INVALID_PLAN; a provider that cannot compute is CHANGE_PREVIEW_FAILED', async () => {
      await t.subscribeOffice(OFFICE);
      const ctx = await t.memberOf();
      t.gateway.listsPlan(PLAN_10, { active: false });
      await expect(t.billing.previewChange(ctx, { planCode: PLAN_10.code })).rejects.toMatchObject({
        code: 'INVALID_PLAN',
      });

      t.gateway.listsPlan(PLAN_10);
      t.gateway.failPreview = true;
      const logger = spyOnLogger();
      await expect(t.billing.previewChange(ctx, { planCode: PLAN_10.code })).rejects.toMatchObject({
        code: 'CHANGE_PREVIEW_FAILED',
      });
      expectNoneLogged(logger.loggedText(), [BUYER]);
    });
  });

  describe('BR-012-17, BR-012-18: downgrade', () => {
    it('BR-012-17: a lower limit is scheduled for the period end; the current plan and limit apply until then', async () => {
      const { providerId } = await t.subscribeOffice(OFFICE);

      const view = await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code });

      expect(t.gateway.scheduledChanges).toEqual([
        expect.objectContaining({ subscriptionId: providerId, priceId: 'price_2' }),
      ]);
      expect(view.plan.code).toBe('escritorio-5');
      expect(view.activeJourneyLimit).toBe(5);
      expect(view.scheduledChange).toEqual({
        planCode: 'escritorio-2',
        planName: 'Escritório 2',
        price: new Decimal('99.90'),
        interval: 'month',
        activeJourneyLimit: 2,
        at: new Date('2026-03-31T12:00:00.000Z'),
      });
    });

    it('BR-012-17: another plan with the SAME limit is scheduled too', async () => {
      await t.subscribeOffice(OFFICE);

      const view = await t.billing.changePlan(await t.memberOf(), {
        planCode: PLAN_5_YEARLY.code,
      });

      expect(view.scheduledChange?.planCode).toBe('escritorio-5-anual');
      expect(t.gateway.priceChanges).toEqual([]);
    });

    it('BR-012-18: a downgrade below the journeys in progress is allowed and closes nothing', async () => {
      await t.subscribeOffice(OFFICE);
      t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 4);

      const view = await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code });

      expect(view.scheduledChange?.activeJourneyLimit).toBe(2);
      expect(view.inProgress).toBe(4);
      expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(4);
    });

    it('BR-012-17: choosing the plan in effect again releases the scheduled downgrade', async () => {
      const { providerId } = await t.subscribeOffice(OFFICE);
      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code });

      const view = await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_5.code });

      expect(t.gateway.releasedSchedules).toEqual([providerId]);
      expect(view.scheduledChange).toBeNull();
    });

    it('BR-012-17: choosing the plan already in effect, with nothing scheduled, does nothing', async () => {
      await t.subscribeOffice(OFFICE);

      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_5.code });

      expect(t.gateway.priceChanges).toEqual([]);
      expect(t.gateway.scheduledChanges).toEqual([]);
      expect(t.gateway.releasedSchedules).toEqual([]);
    });

    it('BR-012-04: a subscriber stays on a WITHDRAWN plan but cannot move to one', async () => {
      await t.subscribeOffice(OFFICE, { plan: PLAN_OLD });

      await expect(
        t.billing.changePlan(await t.memberOf(), { planCode: PLAN_OLD.code }),
      ).resolves.toMatchObject({ plan: { code: 'escritorio-antigo' } });
      await expect(
        t.billing.changePlan(await t.memberOf(), { planCode: 'nope' }),
      ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    });

    it('BR-012-04: moving to a withdrawn plan is refused', async () => {
      await t.subscribeOffice(OFFICE);

      await expect(
        t.billing.changePlan(await t.memberOf(), { planCode: PLAN_OLD.code }),
      ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    });

    it('BR-012-19: a plan that stops at the period end cannot be moved at all: undo the cancellation first', async () => {
      await t.subscribeOffice(OFFICE);
      t.clock.advance(10 * DAY); // past the refund window: a cancel stops renewal only
      await t.billing.cancel(await t.memberOf());

      for (const planCode of [PLAN_2.code, PLAN_10.code]) {
        await expect(t.billing.changePlan(await t.memberOf(), { planCode })).rejects.toMatchObject({
          code: 'SUBSCRIPTION_NOT_CHANGEABLE',
        });
      }
      expect(t.gateway.priceChanges).toEqual([]);
      expect(t.gateway.scheduledChanges).toEqual([]);
    });

    it('BR-012-16: nothing in effect, nothing to change', async () => {
      await expect(
        t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code }),
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_CHANGEABLE' });
    });

    it('BR-012-11: any member changes the plan, and so does one of a read-only office (BR-012-28)', async () => {
      await t.subscribeOffice(OFFICE);

      await expect(
        t.billing.changePlan(await t.memberOf(SECOND_MEMBER, OFFICE, READ_ONLY), {
          planCode: PLAN_2.code,
        }),
      ).resolves.toMatchObject({ scheduledChange: { planCode: 'escritorio-2' } });
    });
  });

  describe('BR-012-29: cancelling the first subscription inside the refund window', () => {
    /** The refund key of an invoice of the subscription (stable, per invoice). */
    const keyOf = (ref: string, invoiceId: string) => `refund:${ref}:${invoiceId}`;
    const createOf = (providerId: string) => `in_create_${providerId}`;
    const invoice = (
      id: string,
      reason: 'subscription_create' | 'subscription_update',
      paid: string,
      status: 'paid' | 'open' = 'paid',
    ) => ({
      id,
      reason,
      status,
      amountPaid: new Decimal(paid),
      amountRefunded: new Decimal(0),
    });

    it('BR-012-29: on day 6 the first payment is refunded in full and the office is lapsed at once', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      t.clock.advance(6 * DAY);

      const view = await t.billing.cancel(await t.memberOf());

      expect(t.gateway.refunds).toEqual([
        {
          invoiceId: createOf(providerId),
          idempotencyKey: keyOf(ref, createOf(providerId)),
          refunded: new Decimal('199.90'),
        },
      ]);
      expect(t.gateway.cancelledSubscriptions).toEqual([providerId]);
      expect(view).toMatchObject({
        status: 'LAPSED',
        activeJourneyLimit: 0,
        refundEligibleUntil: null,
      });
      // BR-012-21: the grace period starts at the lapse.
      expect(view.lapsedAt).toEqual(t.clock.now());
      expect(view.readOnlyAt?.toISOString()).toBe('2026-03-17T12:00:00.000Z');
      expect(t.subscriptions.get(ref).refundedAt).toEqual(t.clock.now());
    });

    it('DL-012-10: after an upgrade paid inside the window the cancel refunds the first payment AND the proration, never only the latest invoice', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      t.gateway.subscriptionInvoices.set(providerId, [
        invoice('in_proration', 'subscription_update', '80.00'), // the latest invoice
        invoice('in_create', 'subscription_create', '199.90'),
      ]);
      t.clock.advance(3 * DAY);

      const view = await t.billing.cancel(await t.memberOf());

      expect(
        t.gateway.refunds.map((refund) => [refund.invoiceId, refund.refunded.toFixed()]),
      ).toEqual([
        ['in_proration', '80'],
        ['in_create', '199.9'],
      ]);
      expect(t.gateway.refundRequests).toEqual([
        keyOf(ref, 'in_proration'),
        keyOf(ref, 'in_create'),
      ]);
      expect(view.status).toBe('LAPSED');
    });

    it('an upgrade proration still unpaid is voided so it cannot be paid after the end; the paid first payment is refunded', async () => {
      const { providerId } = await t.subscribeOffice(OFFICE);
      t.gateway.subscriptionInvoices.set(providerId, [
        invoice('in_open', 'subscription_update', '0', 'open'),
        invoice('in_create', 'subscription_create', '199.90'),
      ]);

      const view = await t.billing.cancel(await t.memberOf());

      expect(t.gateway.voidedInvoices).toEqual(['in_open']);
      expect(t.gateway.refunds.map((refund) => refund.invoiceId)).toEqual(['in_create']);
      expect(view.status).toBe('LAPSED');
    });

    it('BR-012-29: on day 8 nothing is refunded; the plan stays in effect to the end of the paid period', async () => {
      const { ref } = await t.subscribeOffice(OFFICE);
      t.clock.advance(8 * DAY);

      const view = await t.billing.cancel(await t.memberOf());

      expect(t.gateway.refundRequests).toEqual([]);
      expect(t.gateway.cancelledSubscriptions).toEqual([]);
      expect(view).toMatchObject({
        status: 'CANCELING',
        cancelAtPeriodEnd: true,
        activeJourneyLimit: 5,
      });
      expect(t.subscriptions.get(ref).refundedAt).toBeNull();
    });

    it('BR-012-29: exactly 7 days after the first payment is no longer inside the window', async () => {
      await t.subscribeOffice(OFFICE);
      t.clock.advance(7 * DAY);

      await t.billing.cancel(await t.memberOf());

      expect(t.gateway.refundRequests).toEqual([]);
    });

    it('BR-012-29: a second subscription after an earlier PAID lapse is not eligible', async () => {
      const first = await t.subscribeOffice(OFFICE);
      t.gateway.setSubscription({ ...t.gateway.current(first.providerId), status: 'canceled' });
      await t.sync.refresh(first.ref);
      t.clock.advance(20 * DAY);
      await t.subscribeOffice(OFFICE, { plan: PLAN_2 });
      t.clock.advance(1 * DAY); // day 1 of the second subscription

      const view = await t.billing.cancel(await t.memberOf());

      expect(t.gateway.refundRequests).toEqual([]);
      expect(view.status).toBe('CANCELING');
    });

    it('BR-012-29: a first subscription that charged nothing (100% coupon) is NOT an earlier paid one: the later real subscription is eligible', async () => {
      const first = await t.subscribeOffice(OFFICE, { overrides: { firstInvoiceFree: true } });
      expect(t.subscriptions.get(first.ref).firstPaymentFree).toBe(true);
      t.gateway.setSubscription({ ...t.gateway.current(first.providerId), status: 'canceled' });
      await t.sync.refresh(first.ref);
      t.clock.advance(20 * DAY);
      const second = await t.subscribeOffice(OFFICE, { plan: PLAN_2 });
      t.clock.advance(1 * DAY);

      const view = await t.billing.cancel(await t.memberOf());

      expect(t.gateway.refunds.map((refund) => refund.invoiceId)).toEqual([
        createOf(second.providerId),
      ]);
      expect(view.status).toBe('LAPSED');
    });

    it('BR-012-29: a 100% coupon refunds nothing and the subscription still ends', async () => {
      const { providerId } = await t.subscribeOffice(OFFICE);
      t.gateway.paidAmounts.set(providerId, new Decimal(0));

      const view = await t.billing.cancel(await t.memberOf());

      expect(t.gateway.refunds).toEqual([]);
      expect(view.status).toBe('LAPSED');
    });

    it('BR-012-29: renewal stopped on day 2 does not take the right of withdrawal away: on day 5 the cancel still refunds', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE, {
        overrides: { cancelAtPeriodEnd: true },
      });
      expect(t.subscriptions.get(ref).status).toBe('CANCELING');
      t.clock.advance(5 * DAY);

      const view = await t.billing.cancel(await t.memberOf());

      expect(t.gateway.refunds.map((refund) => refund.invoiceId)).toEqual([createOf(providerId)]);
      expect(view.status).toBe('LAPSED');
    });

    it('BR-012-29: a refund that answers zero while the invoice paid money is a failure: nothing is recorded or cancelled, and the claim goes back', async () => {
      const { ref } = await t.subscribeOffice(OFFICE);
      t.gateway.refundAnswersZero = true;

      await expect(t.billing.cancel(await t.memberOf())).rejects.toThrow(
        'A refund returned less than the invoice paid',
      );

      expect(t.subscriptions.get(ref)).toMatchObject({
        status: 'ACTIVE',
        refundedAt: null,
        refundClaimedAt: null,
      });
      expect(t.gateway.cancelledSubscriptions).toEqual([]);
      // The retry, once the provider answers, completes it.
      t.gateway.refundAnswersZero = false;
      expect((await t.billing.cancel(await t.memberOf())).status).toBe('LAPSED');
    });

    it('F2: a refund that fails halfway gives the claim back; the retry refunds only what is left, with the same keys', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      t.gateway.subscriptionInvoices.set(providerId, [
        invoice('in_proration', 'subscription_update', '80.00'),
        invoice('in_create', 'subscription_create', '199.90'),
      ]);
      t.gateway.failRefundFor.add('in_create');

      await expect(t.billing.cancel(await t.memberOf())).rejects.toThrow('provider unreachable');
      expect(t.subscriptions.get(ref)).toMatchObject({
        status: 'ACTIVE',
        refundedAt: null,
        refundClaimedAt: null,
      });
      t.gateway.failRefundFor.clear();

      const view = await t.billing.cancel(await t.memberOf(SECOND_MEMBER));

      expect(view.status).toBe('LAPSED');
      // The proration was refunded once (the provider's own figures show it refunded the second time).
      expect(t.gateway.refunds.map((refund) => refund.invoiceId)).toEqual([
        'in_proration',
        'in_create',
      ]);
    });

    it('F2: a refund confirmed at the provider whose record failed is repaired by the retry, without a second refund', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      const markRefunded = t.subscriptions.markRefunded.bind(t.subscriptions);
      t.subscriptions.markRefunded = () => Promise.reject(new Error('database unreachable'));
      await expect(t.billing.cancel(await t.memberOf())).rejects.toThrow('database unreachable');
      expect(t.subscriptions.get(ref)).toMatchObject({ refundedAt: null, refundClaimedAt: null });
      t.subscriptions.markRefunded = markRefunded;
      const requests = t.gateway.refundRequests.length;

      const view = await t.billing.cancel(await t.memberOf());

      expect(view.status).toBe('LAPSED');
      // The provider shows the invoice refunded: no new refund request, the record is made.
      expect(t.gateway.refundRequests).toHaveLength(requests);
      expect(t.gateway.refunds).toHaveLength(1);
      expect(t.subscriptions.get(ref).refundedAt).not.toBeNull();
      expect(t.gateway.cancelledSubscriptions).toEqual([providerId]);
    });

    it('BR-012-29: a crash between the refund and the cancel is repaired by a retry, refunding once', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      const cancel = t.gateway.cancelSubscription.bind(t.gateway);
      t.gateway.cancelSubscription = () => Promise.reject(new Error('provider unreachable'));
      await expect(t.billing.cancel(await t.memberOf())).rejects.toThrow('provider unreachable');
      expect(t.subscriptions.get(ref)).toMatchObject({ status: 'ACTIVE' });
      expect(t.subscriptions.get(ref).refundedAt).not.toBeNull();
      t.gateway.cancelSubscription = cancel;

      const view = await t.billing.cancel(await t.memberOf());

      expect(view.status).toBe('LAPSED');
      expect(t.gateway.refundRequests).toEqual([keyOf(ref, createOf(providerId))]);
      expect(t.gateway.cancelledSubscriptions).toEqual([providerId]);
    });

    it('F2: a legitimate in-window request completes when retried AFTER the window (judged at the request)', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      t.clock.advance(6 * DAY);
      t.gateway.failRefundFor.add(createOf(providerId));
      await expect(t.billing.cancel(await t.memberOf())).rejects.toThrow('provider unreachable');
      expect(t.subscriptions.get(ref).refundRequestedAt).toEqual(t.clock.now());
      t.gateway.failRefundFor.clear();
      t.clock.advance(5 * DAY); // day 11: outside the window now

      const view = await t.billing.cancel(await t.memberOf());

      expect(view.status).toBe('LAPSED');
      expect(t.gateway.refunds.map((refund) => refund.invoiceId)).toEqual([createOf(providerId)]);
    });

    it('F2: another member holding a LIVE claim is CANCEL_IN_PROGRESS, never a silent 200', async () => {
      const { ref } = await t.subscribeOffice(OFFICE);
      const row = t.subscriptions.rows.get(ref);
      if (!row) throw new Error('no row');
      row.refundClaimedAt = t.clock.now();
      row.refundRequestedAt = t.clock.now();

      await expect(t.billing.cancel(await t.memberOf())).rejects.toMatchObject({
        code: 'CANCEL_IN_PROGRESS',
      });
      expect(t.gateway.refundRequests).toEqual([]);
    });

    it('BR-012-29: a claim whose holder died before it refunded is retaken after 5 minutes, with the same key', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      const row = t.subscriptions.rows.get(ref);
      if (!row) throw new Error('no row');
      row.refundClaimedAt = new Date(t.clock.now().getTime() - REFUND_CLAIM_STALE_MS);

      const view = await t.billing.cancel(await t.memberOf());

      expect(t.gateway.refundRequests).toEqual([keyOf(ref, createOf(providerId))]);
      expect(view.status).toBe('LAPSED');
    });

    it('BR-012-29: two members cancelling at once refund once: the second is told the cancel is in progress', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      // The first refund is slow: the second cancel arrives while it holds the claim.
      t.gateway.onRefund = () => held;

      const first = t.billing.cancel(await t.memberOf(BUYER));
      await expect(t.billing.cancel(await t.memberOf(SECOND_MEMBER))).rejects.toMatchObject({
        code: 'CANCEL_IN_PROGRESS',
      });
      release();
      const firstView = await first;

      expect(firstView.status).toBe('LAPSED');
      expect(t.gateway.refundRequests).toEqual([keyOf(ref, createOf(providerId))]);
      expect(t.gateway.refunds).toHaveLength(1);
    });
  });

  describe('BR-012-19: cancel at the end of the period, and undo', () => {
    it('BR-012-19: stops renewal and keeps the plan until the period ends; a scheduled downgrade is dropped', async () => {
      const { providerId } = await t.subscribeOffice(OFFICE);
      t.clock.advance(10 * DAY);
      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code });

      const view = await t.billing.cancel(await t.memberOf());

      expect(t.gateway.releasedSchedules).toEqual([providerId]);
      expect(t.gateway.cancelAtPeriodEndChanges).toEqual([
        expect.objectContaining({ subscriptionId: providerId, cancel: true }),
      ]);
      expect(view).toMatchObject({ status: 'CANCELING', scheduledChange: null });
    });

    it('BR-012-19: cancelling what is already cancelling does nothing and succeeds', async () => {
      await t.subscribeOffice(OFFICE);
      t.clock.advance(10 * DAY);
      await t.billing.cancel(await t.memberOf());
      const calls = t.gateway.cancelAtPeriodEndChanges.length;

      const view = await t.billing.cancel(await t.memberOf(SECOND_MEMBER));

      expect(view.status).toBe('CANCELING');
      expect(t.gateway.cancelAtPeriodEndChanges).toHaveLength(calls);
    });

    it('BR-012-19: nothing in effect, nothing to cancel', async () => {
      await expect(t.billing.cancel(await t.memberOf())).rejects.toMatchObject({
        code: 'SUBSCRIPTION_NOT_CANCELABLE',
      });
    });

    it('BR-012-19: a member undoes the cancellation before the period ends: the state returns to ACTIVE', async () => {
      await t.subscribeOffice(OFFICE);
      t.clock.advance(10 * DAY);
      await t.billing.cancel(await t.memberOf());

      const view = await t.billing.undoCancel(await t.memberOf(SECOND_MEMBER));

      expect(view).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: false });
      expect(t.gateway.cancelAtPeriodEndChanges.map((change) => change.cancel)).toEqual([
        true,
        false,
      ]);
    });

    it('BR-012-19: cancel, undo and cancel again are three real calls (the keys follow the synced state)', async () => {
      await t.subscribeOffice(OFFICE);
      t.clock.advance(10 * DAY);
      await t.billing.cancel(await t.memberOf());
      t.clock.advance(1 * MINUTE);
      await t.billing.undoCancel(await t.memberOf());
      t.clock.advance(1 * MINUTE);

      const view = await t.billing.cancel(await t.memberOf());

      const keys = t.gateway.cancelAtPeriodEndChanges.map((change) => change.idempotencyKey);
      expect(new Set(keys).size).toBe(3);
      expect(view.status).toBe('CANCELING');
    });

    it('BR-012-19: undoing what was never cancelled succeeds and does nothing', async () => {
      await t.subscribeOffice(OFFICE);

      const view = await t.billing.undoCancel(await t.memberOf());

      expect(view.status).toBe('ACTIVE');
      expect(t.gateway.cancelAtPeriodEndChanges).toEqual([]);
    });

    it('BR-012-19: once the paid period has ended the cancellation cannot be undone', async () => {
      await t.subscribeOffice(OFFICE);
      t.clock.advance(10 * DAY);
      await t.billing.cancel(await t.memberOf());
      t.clock.advance(21 * DAY); // 2026-03-11 + 21 d = the end of the period

      await expect(t.billing.undoCancel(await t.memberOf())).rejects.toMatchObject({
        code: 'SUBSCRIPTION_NOT_CHANGEABLE',
      });
    });

    it('BR-012-19: nothing in effect, nothing to undo', async () => {
      await expect(t.billing.undoCancel(await t.memberOf())).rejects.toMatchObject({
        code: 'SUBSCRIPTION_NOT_CHANGEABLE',
      });
    });
  });

  describe('BR-012-10: the billing portal', () => {
    it('opens the provider page for the office customer, returning to the plan page', async () => {
      await t.subscribeOffice(OFFICE);

      const { url } = await t.billing.billingPortal(await t.memberOf());

      expect(url).toBe('https://billing.example.test/session_1');
      expect(t.gateway.portalSessions).toEqual([
        {
          customerId: 'cus_office_1',
          returnUrl: 'https://app.example.test/office/plan',
          configurationId: 'bpc_test_1',
        },
      ]);
    });

    it('BR-012-28: a lapsed office can still update its payment method', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      t.gateway.setSubscription({ ...t.gateway.current(providerId), status: 'canceled' });
      await t.sync.refresh(ref);

      await expect(
        t.billing.billingPortal(await t.memberOf(BUYER, OFFICE, READ_ONLY)),
      ).resolves.toMatchObject({ url: expect.any(String) as string });
    });

    it('answers BILLING_PORTAL_FAILED when the provider cannot open it', async () => {
      await t.subscribeOffice(OFFICE);
      t.gateway.failPortal = true;

      await expect(t.billing.billingPortal(await t.memberOf())).rejects.toMatchObject({
        code: 'BILLING_PORTAL_FAILED',
      });
    });

    it('an office with no provider customer has no portal', async () => {
      await expect(t.billing.billingPortal(await t.memberOf())).rejects.toMatchObject({
        code: 'SUBSCRIPTION_NOT_FOUND',
      });
    });
  });

  describe('F4: a payment confirmed between the guard and the insert', () => {
    /** Runs `during` right after the checkout record is created, once (the webhook landing now). */
    function landDuring(during: () => Promise<void>) {
      const original = t.subscriptions.createPending.bind(t.subscriptions);
      t.subscriptions.createPending = async (input) => {
        t.subscriptions.createPending = original;
        const created = await original(input);
        await during();
        return created;
      };
    }

    it('BR-012-08: the office got a subscription in effect meanwhile: the record is deleted, nothing reaches the provider', async () => {
      landDuring(async () => {
        await t.subscribeOffice(OFFICE);
      });

      await expect(
        t.billing.checkout(await t.memberOf(), BUYER_INFO, { planCode: PLAN_2.code }),
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_ALREADY_ACTIVE' });

      expect(t.gateway.checkouts).toEqual([]);
      expect(t.gateway.customers).toEqual([]);
      expect([...t.subscriptions.rows.values()].map((row) => row.status)).toEqual(['ACTIVE']);
      expect(t.subscriptions.openKeys.size).toBe(0); // the deleted checkout released its key
    });

    it('BR-012-07: the buyer got a first subscription in effect (office not created yet) meanwhile: refused the same way', async () => {
      landDuring(async () => {
        const first = await t.subscriptions.createPending({
          buyerUserId: BUYER,
          planId: PLAN_5.id,
          planCode: PLAN_5.code,
          activeJourneyLimit: 5,
        });
        const row = t.subscriptions.rows.get(first.id);
        if (row) row.status = 'ACTIVE';
      });

      await expect(
        t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_ALREADY_ACTIVE' });

      expect(t.gateway.checkouts).toEqual([]);
      expect(t.subscriptions.rows.size).toBe(1);
    });

    it('BR-012-07: a buyer whose first subscription is in effect and waits for its office cannot start another', async () => {
      const first = await t.subscriptions.createPending({
        buyerUserId: BUYER,
        planId: PLAN_5.id,
        planCode: PLAN_5.code,
        activeJourneyLimit: 5,
      });
      const row = t.subscriptions.rows.get(first.id);
      if (row) row.status = 'ACTIVE';

      await expect(
        t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_ALREADY_ACTIVE' });
      expect(t.subscriptions.rows.size).toBe(1);
    });

    it("BR-012-07: the buyer's open-checkout key lives until the office is attached, not until the payment", async () => {
      await t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code });
      const [pending] = [...t.subscriptions.rows.values()];
      const ref = pending?.id ?? '';
      t.gateway.setSubscription(
        aProviderSubscription({ id: 'sub_late', subscriptionRef: ref, priceId: 'price_5' }),
      );
      const event = {
        id: 'evt_late',
        type: 'checkout.completed' as const,
        subscriptionId: 'sub_late',
        subscriptionRef: ref,
      };
      t.provisioner.failNext = true; // SPEC-011 cannot create the office yet

      await expect(t.sync.handleProviderEvent(event)).rejects.toThrow('office store unreachable');
      expect(t.subscriptions.get(ref).status).toBe('ACTIVE');
      expect(t.subscriptions.openKeys.has(ref)).toBe(true); // paid, no office: still holds the key
      await expect(
        t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_ALREADY_ACTIVE' });

      await t.sync.handleProviderEvent(event); // the retry: the office is created and attached
      expect(t.subscriptions.get(ref).officeId).not.toBeNull();
      expect(t.subscriptions.openKeys.has(ref)).toBe(false);
    });
  });

  describe('F3: a checkout the buyer paid while the events never arrived', () => {
    async function pendingWithSession() {
      await t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code });
      const [record] = [...t.subscriptions.rows.values()];
      if (!record) throw new Error('no record');
      return record;
    }
    const paid = (ref: string) =>
      t.gateway.setSubscription(
        aProviderSubscription({ id: 'sub_paid', subscriptionRef: ref, priceId: 'price_5' }),
      );

    it('a session the provider shows complete is read through the normal sync: the office is created, no event needed', async () => {
      const record = await pendingWithSession();
      paid(record.id);
      t.gateway.checkoutSessions.set('cs_fake_1', {
        state: 'complete',
        subscriptionId: 'sub_paid',
      });

      await expect(t.billing.recoverPendingCheckout(record)).resolves.toBe('recovered');

      expect(t.subscriptions.get(record.id)).toMatchObject({
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_paid',
      });
      expect(t.subscriptions.get(record.id).officeId).not.toBeNull();
    });

    it('a session the provider shows expired leaves nothing; one still open and young is waited for', async () => {
      const record = await pendingWithSession();

      await expect(t.billing.recoverPendingCheckout(record)).resolves.toBe('waiting');
      expect(t.subscriptions.rows.size).toBe(1);

      t.gateway.checkoutSessions.set('cs_fake_1', { state: 'expired', subscriptionId: null });
      await expect(t.billing.recoverPendingCheckout(record)).resolves.toBe('removed');
      expect(t.subscriptions.rows.size).toBe(0);
    });

    it('a session still open after 24 hours is closed first, then removed', async () => {
      const record = await pendingWithSession();
      t.clock.advance(25 * 60 * MINUTE);

      await expect(t.billing.recoverPendingCheckout(record)).resolves.toBe('removed');

      expect(t.gateway.expiredSessions).toEqual(['cs_fake_1']);
      expect(t.subscriptions.rows.size).toBe(0);
    });

    it('a record is NEVER removed on a provider error: it stays for the next look', async () => {
      const record = await pendingWithSession();
      t.gateway.failSessionLookup = true;

      await expect(t.billing.recoverPendingCheckout(record)).rejects.toThrow(
        'provider unreachable',
      );

      expect(t.subscriptions.rows.size).toBe(1);
    });

    it('a record with no session id is not this method’s to judge', async () => {
      const orphan = await t.subscriptions.createPending({
        buyerUserId: BUYER,
        planId: PLAN_5.id,
        planCode: PLAN_5.code,
        activeJourneyLimit: 5,
      });

      await expect(t.billing.recoverPendingCheckout(orphan)).resolves.toBe('waiting');
    });

    it('BR-012-09: the success page asks the provider about an old unconfirmed checkout and shows CONFIRMED once it is recovered', async () => {
      const ctx = await t.noOffice();
      const record = await pendingWithSession();
      paid(record.id);
      t.gateway.checkoutSessions.set('cs_fake_1', {
        state: 'complete',
        subscriptionId: 'sub_paid',
      });

      // Young: the page does not ask the provider (the webhook is probably about to arrive).
      expect(await t.billing.checkoutState(ctx, record.id)).toBe('PENDING');
      t.clock.advance(11 * MINUTE);

      expect(await t.billing.checkoutState(ctx, record.id)).toBe('CONFIRMED');
    });

    it('the success page answers PENDING, not an error, when the provider cannot be asked', async () => {
      const ctx = await t.noOffice();
      const record = await pendingWithSession();
      t.clock.advance(11 * MINUTE);
      t.gateway.failSessionLookup = true;

      expect(await t.billing.checkoutState(ctx, record.id)).toBe('PENDING');
    });

    it('the success page of an expired session says PENDING and the record is gone (the buyer starts again)', async () => {
      const ctx = await t.noOffice();
      const record = await pendingWithSession();
      t.gateway.checkoutSessions.set('cs_fake_1', { state: 'expired', subscriptionId: null });
      t.clock.advance(11 * MINUTE);

      expect(await t.billing.checkoutState(ctx, record.id)).toBe('PENDING');
      expect(t.subscriptions.rows.size).toBe(0);
    });
  });

  describe('F5: the billing portal fails closed in production without its restricted configuration', () => {
    const productionWithout = () =>
      build({ NODE_ENV: 'production', STRIPE_BILLING_PORTAL_CONFIGURATION_ID: undefined });

    it('SC-16: production without STRIPE_BILLING_PORTAL_CONFIGURATION_ID: BILLING_PORTAL_FAILED, nothing opened, a warning names no data', async () => {
      const prod = productionWithout();
      await prod.subscribeOffice(OFFICE);
      const logger = spyOnLogger();

      await expect(prod.billing.billingPortal(await prod.memberOf())).rejects.toMatchObject({
        code: 'BILLING_PORTAL_FAILED',
      });

      expect(prod.gateway.portalSessions).toEqual([]);
      const logged = logger.loggedText();
      expect(logged).toContain('STRIPE_BILLING_PORTAL_CONFIGURATION_ID');
      expectNoneLogged(logged, ['cus_office_1', OFFICE]);
      vi.restoreAllMocks();
    });

    it('production WITH the configuration opens the portal; outside production the default configuration is fine', async () => {
      const prod = build({ NODE_ENV: 'production' });
      await prod.subscribeOffice(OFFICE);
      await prod.billing.billingPortal(await prod.memberOf());
      expect(prod.gateway.portalSessions[0]?.configurationId).toBe('bpc_test_1');

      const dev = build({
        NODE_ENV: 'development',
        STRIPE_BILLING_PORTAL_CONFIGURATION_ID: undefined,
      });
      await dev.subscribeOffice(OFFICE);
      await dev.billing.billingPortal(await dev.memberOf());
      expect(dev.gateway.portalSessions[0]).not.toHaveProperty('configurationId');
    });
  });

  describe('F7: idempotency keys come from the facts that define the action', () => {
    it('a retry of an upgrade after an unrelated webhook sync reuses the key; a later different action does not', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code });
      // An unrelated event syncs the record meanwhile (lastSyncedAt moves).
      t.clock.advance(2 * MINUTE);
      await t.sync.refresh(ref);

      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code }); // the retry
      const [first, retry] = t.gateway.priceChanges;
      expect(retry?.idempotencyKey).toBe(first?.idempotencyKey);

      t.gateway.payPendingChange(providerId);
      await t.sync.refresh(ref);
      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code }); // another action
      expect(t.gateway.scheduledChanges[0]?.idempotencyKey).not.toBe(first?.idempotencyKey);
    });

    it('the same upgrade from another plan, or in another period, is another key', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE, { plan: PLAN_2 });
      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code });
      t.gateway.payPendingChange(providerId);
      await t.sync.refresh(ref);
      t.gateway.setSubscription({
        ...t.gateway.current(providerId),
        priceId: 'price_2',
        currentPeriodStart: new Date(t.clock.now().getTime() + 30 * DAY),
      });
      await t.sync.refresh(ref);

      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code });

      const keys = t.gateway.priceChanges.map((change) => change.idempotencyKey);
      expect(new Set(keys).size).toBe(2);
    });
  });

  describe('F8, F14: changing the plan fails safe', () => {
    it('BR-012-17: the price is changed FIRST; the downgrade scheduled before is released only after it succeeded', async () => {
      await t.subscribeOffice(OFFICE);
      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code });
      t.gateway.callLog.length = 0;

      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code });

      expect(t.gateway.callLog).toEqual(['price', 'release']);
    });

    it('a rejected upgrade is CHANGE_PLAN_FAILED (502), not a 500, and the scheduled downgrade is kept', async () => {
      const { ref } = await t.subscribeOffice(OFFICE);
      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code });
      t.gateway.callLog.length = 0;
      t.gateway.failChanges = true;
      const logger = spyOnLogger();

      await expect(
        t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code }),
      ).rejects.toMatchObject({ code: 'CHANGE_PLAN_FAILED' });

      expect(t.gateway.releasedSchedules).toEqual([]);
      expect(t.subscriptions.get(ref).scheduledPlanId).toBe(PLAN_2.id);
      expectNoneLogged(logger.loggedText(), ['rejected the change']);
      vi.restoreAllMocks();
    });

    it('a rejected downgrade or release is CHANGE_PLAN_FAILED too', async () => {
      await t.subscribeOffice(OFFICE);
      t.gateway.failChanges = true;

      await expect(
        t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code }),
      ).rejects.toMatchObject({ code: 'CHANGE_PLAN_FAILED' });
      t.gateway.failChanges = false;
      await t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code });
      t.gateway.failChanges = true;
      await expect(
        t.billing.changePlan(await t.memberOf(), { planCode: PLAN_5.code }),
      ).rejects.toMatchObject({ code: 'CHANGE_PLAN_FAILED' });
    });

    it('F14: a target price the provider archived (or no longer knows) is INVALID_PLAN, nothing is asked', async () => {
      await t.subscribeOffice(OFFICE);
      t.gateway.listsPlan(PLAN_10, { active: false });
      await expect(
        t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code }),
      ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
      t.gateway.prices.delete('price_2');
      await expect(
        t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code }),
      ).rejects.toMatchObject({ code: 'INVALID_PLAN' });

      expect(t.gateway.priceChanges).toEqual([]);
      expect(t.gateway.scheduledChanges).toEqual([]);
    });

    it('F14: a provider that cannot be asked about the price is CHANGE_PLAN_FAILED', async () => {
      await t.subscribeOffice(OFFICE);
      t.gateway.failPriceLookup = true;

      await expect(
        t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code }),
      ).rejects.toMatchObject({ code: 'CHANGE_PLAN_FAILED' });
    });
  });

  describe('F9: one customer per buyer, and the invoice list is read once in a while', () => {
    it('a buyer who already has a customer at the provider (found by our user id) gets no second one', async () => {
      t.gateway.customersByUser.set(BUYER, 'cus_existing');

      await t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code });

      expect(t.gateway.customers).toEqual([]);
      expect(t.gateway.checkouts[0]?.customerId).toBe('cus_existing');
    });

    it('a buyer whose earlier record carries a customer reuses it, even for another office', async () => {
      await t.subscribeOffice(OTHER_OFFICE); // BUYER bought it: its record carries cus_office_1
      t.gateway.customers.length = 0;

      await t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code });

      expect(t.gateway.customers).toEqual([]);
      expect(t.gateway.checkouts[0]?.customerId).toBe('cus_office_1');
    });

    it('a failing customer search falls back to creating one, never to a failed checkout', async () => {
      t.gateway.findCustomerByUserId = () => Promise.reject(new Error('search lags'));

      await t.billing.checkout(await t.noOffice(), BUYER_INFO, { planCode: PLAN_5.code });

      expect(t.gateway.customers).toHaveLength(1);
    });

    it('the invoice list is reused for 30 seconds and dropped by every action of ours', async () => {
      const { ref } = await t.subscribeOffice(OFFICE);
      const ctx = await t.memberOf();
      const page = { page: 1, pageSize: 6 };
      await t.billing.invoices(ctx, undefined, page);
      await t.billing.invoices(ctx, undefined, page);
      expect(t.gateway.invoiceReads).toBe(1);

      t.clock.advance(INVOICE_CACHE_MS);
      await t.billing.invoices(ctx, undefined, page);
      expect(t.gateway.invoiceReads).toBe(2);

      // The cache is warm (the read just above). An action of ours refreshes the record and drops it:
      // the next read asks the provider again.
      await t.billing.changePlan(ctx, { planCode: PLAN_2.code });
      expect(t.subscriptions.get(ref).scheduledPlanId).toBe(PLAN_2.id);
      await t.billing.invoices(ctx, undefined, page);
      expect(t.gateway.invoiceReads).toBe(3);
    });
  });
});
