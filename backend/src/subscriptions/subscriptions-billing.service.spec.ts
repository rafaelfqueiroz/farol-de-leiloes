// SPEC-012 BR-012-06..BR-012-11, BR-012-16..BR-012-19, BR-012-29: what a member of an office does
// with its plan, against hand-written fakes of every port (TS-03, TS-07): the payment provider,
// the subscription store, the plan catalog, the coupons, the journey counters and SPEC-011's
// office provisioner. The real conditional updates these fakes imitate (the open-checkout key, the
// refund claim) are proven against MongoDB in test/integration/subscriptions-billing.spec.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AccessContext } from '../access/access-context.js';
import type { OwnerCounterRepository } from '../access/owner-counter.repository.js';
import type { OfficePlanState } from '../access/sources/office-plan.source.js';
import { DomainError } from '../common/errors/domain-error.js';
import { Decimal } from '../common/money/money.js';
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
import { testBusinessConfig, testConfigService } from '../../test/support/test-env.js';
import { JourneySlotsService, ACTIVE_JOURNEYS_KEY } from './journey-slots.service.js';
import type { PaymentEventsRepository } from './payment-events.repository.js';
import {
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

function build() {
  const clock = new FakeClock(FIRST_PAID);
  const gateway = new FakePaymentGateway();
  const subscriptions = new FakeSubscriptionsRepository(() => clock.now());
  const plans = new InMemoryPlans([PLAN_5, PLAN_2, PLAN_10, PLAN_5_YEARLY, PLAN_OLD]);
  const provisioner = new FakeOfficeProvisioner();
  const counters = new FakeOwnerCounters();
  const coupons = new FakeCoupons();
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
        latestInvoicePaidAt: clock.now(),
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
        { ...BUYER_INFO, userId: BUYER, idempotencyKey: `customer:${pending?.id}` },
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
    it('shows the plan, the limit, the count against it, the dates and the billing history', async () => {
      await t.subscribeOffice(OFFICE);
      t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 4);
      t.gateway.invoices = [
        {
          id: 'in_1',
          paidAt: FIRST_PAID,
          amount: new Decimal('199.9'),
          status: 'paid',
          hostedUrl: 'https://invoice.example.test/in_1',
        },
      ];

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
      });
      expect(view.plan.price.toFixed(2)).toBe('199.90');
      expect(view.currentPeriodEnd?.toISOString()).toBe('2026-03-31T12:00:00.000Z');
      expect(view.invoices).toEqual(t.gateway.invoices);
    });

    it('BR-012-11: ANY member sees it, not only the one who paid', async () => {
      await t.subscribeOffice(OFFICE);

      const view = await t.billing.view(await t.memberOf(SECOND_MEMBER));

      expect(view.status).toBe('ACTIVE');
    });

    it('a billing history the provider cannot give right now does not break the page', async () => {
      await t.subscribeOffice(OFFICE);
      t.gateway.failInvoices = true;

      const view = await t.billing.view(await t.memberOf());

      expect(view.invoices).toBeNull();
      expect(view.status).toBe('ACTIVE');
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

    it('BR-012-19: a plan that stops at the period end cannot be moved down, only up', async () => {
      await t.subscribeOffice(OFFICE);
      t.clock.advance(10 * DAY); // past the refund window: a cancel stops renewal only
      await t.billing.cancel(await t.memberOf());

      await expect(
        t.billing.changePlan(await t.memberOf(), { planCode: PLAN_2.code }),
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_CHANGEABLE' });
      await expect(
        t.billing.changePlan(await t.memberOf(), { planCode: PLAN_10.code }),
      ).resolves.toMatchObject({ status: 'CANCELING' });
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
    it('BR-012-29: on day 6 the full amount is refunded and the office is lapsed at once', async () => {
      const { ref, providerId } = await t.subscribeOffice(OFFICE);
      t.clock.advance(6 * DAY);

      const view = await t.billing.cancel(await t.memberOf());

      expect(t.gateway.refunds).toEqual([
        {
          subscriptionId: providerId,
          idempotencyKey: `refund:${ref}`,
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

    it('BR-012-29: a second subscription after an earlier lapse is not eligible', async () => {
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

    it('BR-012-29: a 100% coupon refunds nothing and the subscription still ends', async () => {
      const { providerId } = await t.subscribeOffice(OFFICE);
      t.gateway.paidAmounts.set(providerId, new Decimal(0));

      const view = await t.billing.cancel(await t.memberOf());

      expect(t.gateway.refunds).toEqual([]);
      expect(view.status).toBe('LAPSED');
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
      expect(t.gateway.refundRequests).toEqual([`refund:${ref}`]);
      expect(t.gateway.cancelledSubscriptions).toEqual([providerId]);
    });

    it('BR-012-29: a claim whose holder died before it refunded is retaken after 5 minutes, with the same key', async () => {
      const { ref } = await t.subscribeOffice(OFFICE);
      const row = t.subscriptions.rows.get(ref);
      if (!row) throw new Error('no row');
      row.refundClaimedAt = new Date(t.clock.now().getTime() - REFUND_CLAIM_STALE_MS);

      const view = await t.billing.cancel(await t.memberOf());

      expect(t.gateway.refundRequests).toEqual([`refund:${ref}`]);
      expect(view.status).toBe('LAPSED');
    });

    it('BR-012-29: two members cancelling at once refund once', async () => {
      const { ref } = await t.subscribeOffice(OFFICE);
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      // The first refund is slow: the second cancel arrives while it holds the claim.
      t.gateway.onRefund = () => held;

      const first = t.billing.cancel(await t.memberOf(BUYER));
      const second = await t.billing.cancel(await t.memberOf(SECOND_MEMBER));
      expect(second.status).toBe('ACTIVE'); // not its to finish: the claim is the other cancel's
      release();
      const firstView = await first;

      expect(firstView.status).toBe('LAPSED');
      expect(t.gateway.refundRequests).toEqual([`refund:${ref}`]);
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
});
