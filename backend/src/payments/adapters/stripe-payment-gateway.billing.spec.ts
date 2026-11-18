// SPEC-012 BR-012-10, BR-012-16, BR-012-17, BR-012-19, BR-012-29, AR-20: the billing operations of
// the Stripe adapter, in our vocabulary in and out. The Stripe client is replaced by a stub that
// records the calls, so nothing reaches Stripe (TS-07): this file proves WHAT is asked of Stripe
// (the parameters, the idempotency keys, centavos only here); the product rules are the billing
// service's.
import { describe, expect, it, vi } from 'vitest';
import { Decimal } from '../../common/money/money.js';
import { centavosToReais, StripePaymentGateway } from './stripe-payment-gateway.js';
import { testConfigService } from '../../../test/support/test-env.js';

function build() {
  const gateway = new StripePaymentGateway(testConfigService());
  const stripe = {
    customers: { create: vi.fn().mockResolvedValue({ id: 'cus_1' }) },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }),
        expire: vi.fn().mockResolvedValue({}),
        retrieve: vi.fn(),
      },
    },
    subscriptions: { retrieve: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    subscriptionSchedules: {
      create: vi.fn().mockResolvedValue({
        id: 'sub_sched_new',
        current_phase: { start_date: 1000, end_date: 2000 },
      }),
      update: vi.fn().mockResolvedValue({}),
      release: vi.fn().mockResolvedValue({}),
      retrieve: vi.fn(),
    },
    prices: { retrieve: vi.fn() },
    refunds: { create: vi.fn().mockResolvedValue({ id: 're_1' }) },
    invoicePayments: { list: vi.fn() },
    invoices: { list: vi.fn() },
    billingPortal: {
      sessions: { create: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.test/s' }) },
    },
  };
  Object.assign(gateway, { stripe });
  return { gateway, stripe };
}

const ITEM = { id: 'si_1', price: { id: 'price_5' } };

describe('AR-20: centavosToReais', () => {
  it.each([
    [19990, '199.9'],
    [1, '0.01'],
    [0, '0'],
    [123456789, '1234567.89'],
  ])('%i centavos = R$ %s, exactly', (centavos, reais) => {
    expect(centavosToReais(centavos).equals(new Decimal(reais))).toBe(true);
  });
});

describe('StripePaymentGateway billing operations', () => {
  describe('createCustomer', () => {
    it('keeps the idempotency key so a retried checkout does not make a second customer', async () => {
      const { gateway, stripe } = build();

      await gateway.createCustomer({
        email: 'ana@example.test',
        name: 'Ana',
        userId: 'u1',
        idempotencyKey: 'customer:ref1',
      });
      await gateway.createCustomer({ email: 'ana@example.test', name: 'Ana', userId: 'u1' });

      expect(stripe.customers.create.mock.calls).toEqual([
        [
          { email: 'ana@example.test', name: 'Ana', metadata: { userId: 'u1' } },
          { idempotencyKey: 'customer:ref1' },
        ],
        [{ email: 'ana@example.test', name: 'Ana', metadata: { userId: 'u1' } }, undefined],
      ]);
    });
  });

  describe('createOfficeCheckout (BR-012-10)', () => {
    const input = {
      customerId: 'cus_1',
      priceId: 'price_5',
      subscriptionRef: 'ref_1',
      successUrl: 'https://app.example.test/plans/success?ref=ref_1',
      cancelUrl: 'https://app.example.test/plans/cancel',
      expiresAt: new Date('2026-03-01T13:00:00.000Z'),
      idempotencyKey: 'checkout:ref_1',
    };

    it('ADR-005: puts our ref in the session AND the subscription metadata, with the urls and the expiry', async () => {
      const { gateway, stripe } = build();

      await expect(gateway.createOfficeCheckout(input)).resolves.toEqual({
        sessionId: 'cs_1',
        url: 'https://checkout.stripe.test/cs_1',
      });

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        {
          mode: 'subscription',
          customer: 'cus_1',
          line_items: [{ price: 'price_5', quantity: 1 }],
          metadata: { subscriptionRef: 'ref_1' },
          subscription_data: { metadata: { subscriptionRef: 'ref_1' } },
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          expires_at: 1772370000, // 2026-03-01T13:00:00Z
          locale: 'pt-BR',
        },
        { idempotencyKey: 'checkout:ref_1' },
      );
    });

    it('BR-026-08: a promotion code becomes a discount on the new subscription', async () => {
      const { gateway, stripe } = build();

      await gateway.createOfficeCheckout({ ...input, promotionCodeId: 'promo_1' });

      expect(stripe.checkout.sessions.create.mock.calls[0]?.[0]).toMatchObject({
        discounts: [{ promotion_code: 'promo_1' }],
      });
    });

    it('a session the provider answers without a URL is a fault, never a link to nowhere', async () => {
      const { gateway, stripe } = build();
      stripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: null });

      await expect(gateway.createOfficeCheckout(input)).rejects.toThrow('without a URL');
    });
  });

  describe('expireCheckoutSession', () => {
    it('closes an open session', async () => {
      const { gateway, stripe } = build();

      await expect(gateway.expireCheckoutSession('cs_1')).resolves.toBe('expired');

      expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_1');
    });

    it('says a session already expired is expired, and a paid one is completed', async () => {
      const { gateway, stripe } = build();
      stripe.checkout.sessions.expire.mockRejectedValue(new Error('not open'));

      stripe.checkout.sessions.retrieve.mockResolvedValue({ status: 'expired' });
      await expect(gateway.expireCheckoutSession('cs_1')).resolves.toBe('expired');
      stripe.checkout.sessions.retrieve.mockResolvedValue({ status: 'complete' });
      await expect(gateway.expireCheckoutSession('cs_1')).resolves.toBe('completed');
    });

    it('surfaces the fault when the session cannot be read either', async () => {
      const { gateway, stripe } = build();
      stripe.checkout.sessions.expire.mockRejectedValue(new Error('provider unreachable'));
      stripe.checkout.sessions.retrieve.mockRejectedValue(new Error('provider unreachable'));

      await expect(gateway.expireCheckoutSession('cs_1')).rejects.toThrow('provider unreachable');
    });
  });

  describe('changeSubscriptionPrice (BR-012-16)', () => {
    it('asks for the prorated difference now and a pending update until it is paid', async () => {
      const { gateway, stripe } = build();
      stripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [ITEM] } });

      await gateway.changeSubscriptionPrice({
        subscriptionId: 'sub_1',
        priceId: 'price_10',
        idempotencyKey: 'upgrade:k',
      });

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_1',
        {
          items: [{ id: 'si_1', price: 'price_10' }],
          proration_behavior: 'always_invoice',
          payment_behavior: 'pending_if_incomplete',
        },
        { idempotencyKey: 'upgrade:k' },
      );
    });

    it('refuses a subscription that is not single-item: never a guess of which item to change', async () => {
      const { gateway, stripe } = build();
      stripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [ITEM, ITEM] } });

      await expect(
        gateway.changeSubscriptionPrice({
          subscriptionId: 'sub_1',
          priceId: 'p',
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow('exactly one item');
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe('scheduleSubscriptionPrice (BR-012-17)', () => {
    const input = { subscriptionId: 'sub_1', priceId: 'price_2', idempotencyKey: 'schedule:k' };
    const phases = [
      { items: [{ price: 'price_5', quantity: 1 }], start_date: 1000, end_date: 2000 },
      {
        items: [{ price: 'price_2', quantity: 1 }],
        duration: { interval: 'month', interval_count: 1 },
      },
    ];

    it('creates a schedule from the subscription: the current price to the period end, then the new one', async () => {
      const { gateway, stripe } = build();
      stripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [ITEM] }, schedule: null });
      stripe.prices.retrieve.mockResolvedValue({ recurring: { interval: 'month' } });

      await gateway.scheduleSubscriptionPrice(input);

      expect(stripe.subscriptionSchedules.create).toHaveBeenCalledWith(
        { from_subscription: 'sub_1' },
        { idempotencyKey: 'schedule:k:schedule' },
      );
      expect(stripe.subscriptionSchedules.update).toHaveBeenCalledWith(
        'sub_sched_new',
        { phases, end_behavior: 'release', proration_behavior: 'none' },
        { idempotencyKey: 'schedule:k' },
      );
    });

    it('replaces the change of a schedule that already exists, creating nothing', async () => {
      const { gateway, stripe } = build();
      stripe.subscriptions.retrieve.mockResolvedValue({
        items: { data: [ITEM] },
        schedule: { id: 'sub_sched_old', current_phase: { start_date: 1000, end_date: 2000 } },
      });
      stripe.prices.retrieve.mockResolvedValue({ recurring: { interval: 'month' } });

      await gateway.scheduleSubscriptionPrice(input);

      expect(stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
      expect(stripe.subscriptionSchedules.update.mock.calls[0]?.[0]).toBe('sub_sched_old');
    });

    it('a yearly price lasts one year after the change', async () => {
      const { gateway, stripe } = build();
      stripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [ITEM] }, schedule: null });
      stripe.prices.retrieve.mockResolvedValue({ recurring: { interval: 'year' } });

      await gateway.scheduleSubscriptionPrice(input);

      const update = stripe.subscriptionSchedules.update.mock.calls[0]?.[1] as {
        phases: Array<{ duration?: unknown }>;
      };
      expect(update.phases[1]?.duration).toEqual({ interval: 'year', interval_count: 1 });
    });

    it('refuses a price that does not recur monthly or yearly, and a schedule with no current phase', async () => {
      const { gateway, stripe } = build();
      stripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [ITEM] }, schedule: null });
      stripe.prices.retrieve.mockResolvedValue({ recurring: { interval: 'week' } });
      await expect(gateway.scheduleSubscriptionPrice(input)).rejects.toThrow('monthly or yearly');

      stripe.prices.retrieve.mockResolvedValue({ recurring: { interval: 'month' } });
      stripe.subscriptionSchedules.create.mockResolvedValue({ id: 's', current_phase: null });
      await expect(gateway.scheduleSubscriptionPrice(input)).rejects.toThrow('no current phase');
    });
  });

  describe('releaseScheduledChange (BR-012-17)', () => {
    it('releases the schedule of the subscription', async () => {
      const { gateway, stripe } = build();
      stripe.subscriptions.retrieve.mockResolvedValue({ schedule: 'sub_sched_1' });

      await gateway.releaseScheduledChange('sub_1', 'release:k');

      expect(stripe.subscriptionSchedules.release).toHaveBeenCalledWith('sub_sched_1', undefined, {
        idempotencyKey: 'release:k',
      });
    });

    it('does nothing when nothing is scheduled', async () => {
      const { gateway, stripe } = build();
      stripe.subscriptions.retrieve.mockResolvedValue({ schedule: null });

      await gateway.releaseScheduledChange('sub_1', 'release:k');

      expect(stripe.subscriptionSchedules.release).not.toHaveBeenCalled();
    });

    it('is idempotent: a schedule already released (two members at once) is a success; any other failure is not', async () => {
      const { gateway, stripe } = build();
      stripe.subscriptions.retrieve.mockResolvedValue({ schedule: { id: 'sub_sched_1' } });
      stripe.subscriptionSchedules.release.mockRejectedValue(new Error('already released'));

      stripe.subscriptionSchedules.retrieve.mockResolvedValue({ status: 'released' });
      await expect(gateway.releaseScheduledChange('sub_1', 'k')).resolves.toBeUndefined();
      stripe.subscriptionSchedules.retrieve.mockResolvedValue({ status: 'canceled' });
      await expect(gateway.releaseScheduledChange('sub_1', 'k')).resolves.toBeUndefined();
      stripe.subscriptionSchedules.retrieve.mockResolvedValue({ status: 'active' });
      await expect(gateway.releaseScheduledChange('sub_1', 'k')).rejects.toThrow(
        'already released',
      );
    });
  });

  describe('setCancelAtPeriodEnd (BR-012-19)', () => {
    it.each([true, false])('sets cancel_at_period_end to %s with its key', async (cancel) => {
      const { gateway, stripe } = build();

      await gateway.setCancelAtPeriodEnd({
        subscriptionId: 'sub_1',
        cancel,
        idempotencyKey: 'cancel:k',
      });

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_1',
        { cancel_at_period_end: cancel },
        { idempotencyKey: 'cancel:k' },
      );
    });
  });

  describe('refundLatestPayment (BR-012-29)', () => {
    const paidInvoice = { id: 'in_1', status: 'paid', amount_paid: 19990 };
    const withInvoice = (stripe: ReturnType<typeof build>['stripe'], invoice: unknown) =>
      stripe.subscriptions.retrieve.mockResolvedValue({ latest_invoice: invoice });
    const withPayment = (stripe: ReturnType<typeof build>['stripe']) =>
      stripe.invoicePayments.list.mockResolvedValue({
        data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_1' } }],
      });

    it('refunds the whole amount paid of the latest invoice, with a stable key, and answers it in reais', async () => {
      const { gateway, stripe } = build();
      withInvoice(stripe, paidInvoice);
      withPayment(stripe);

      const result = await gateway.refundLatestPayment({
        subscriptionId: 'sub_1',
        idempotencyKey: 'refund:ref_1',
      });

      expect(stripe.refunds.create).toHaveBeenCalledWith(
        { payment_intent: 'pi_1', amount: 19990, reason: 'requested_by_customer' },
        { idempotencyKey: 'refund:ref_1' },
      );
      expect(result.refunded.equals(new Decimal('199.9'))).toBe(true);
    });

    it('refunds nothing for an invoice that charged nothing (a 100% coupon) or is not paid', async () => {
      const { gateway, stripe } = build();
      const input = { subscriptionId: 'sub_1', idempotencyKey: 'k' };

      withInvoice(stripe, { ...paidInvoice, amount_paid: 0 });
      expect((await gateway.refundLatestPayment(input)).refunded.isZero()).toBe(true);
      withInvoice(stripe, { ...paidInvoice, status: 'open' });
      expect((await gateway.refundLatestPayment(input)).refunded.isZero()).toBe(true);
      withInvoice(stripe, 'in_not_expanded');
      expect((await gateway.refundLatestPayment(input)).refunded.isZero()).toBe(true);

      expect(stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('a payment that was already refunded in full (an earlier run, past the key retention) counts as done', async () => {
      const { gateway, stripe } = build();
      withInvoice(stripe, paidInvoice);
      withPayment(stripe);
      stripe.refunds.create.mockRejectedValue(
        Object.assign(new Error('already refunded'), { code: 'charge_already_refunded' }),
      );

      const result = await gateway.refundLatestPayment({
        subscriptionId: 'sub_1',
        idempotencyKey: 'k',
      });

      expect(result.refunded.equals(new Decimal('199.9'))).toBe(true);
    });

    it('any other refund failure surfaces, so nothing is recorded as refunded', async () => {
      const { gateway, stripe } = build();
      withInvoice(stripe, paidInvoice);
      withPayment(stripe);
      stripe.refunds.create.mockRejectedValue(new Error('provider unreachable'));

      await expect(
        gateway.refundLatestPayment({ subscriptionId: 'sub_1', idempotencyKey: 'k' }),
      ).rejects.toThrow('provider unreachable');
    });

    it('a paid invoice with no payment to refund is a fault', async () => {
      const { gateway, stripe } = build();
      withInvoice(stripe, paidInvoice);
      stripe.invoicePayments.list.mockResolvedValue({ data: [{ payment: { type: 'charge' } }] });

      await expect(
        gateway.refundLatestPayment({ subscriptionId: 'sub_1', idempotencyKey: 'k' }),
      ).rejects.toThrow('no payment to refund');
    });
  });

  describe('listInvoices (BR-012-11)', () => {
    it('maps invoices into our vocabulary: reais, instants, our statuses', async () => {
      const { gateway, stripe } = build();
      stripe.invoices.list.mockResolvedValue({
        data: [
          {
            id: 'in_2',
            status: 'paid',
            total: 19990,
            status_transitions: { paid_at: 1772366405 },
            hosted_invoice_url: 'https://invoice.stripe.test/in_2',
          },
          {
            id: 'in_3',
            status: 'open',
            total: 9990,
            status_transitions: { paid_at: null },
          },
          { id: 'in_4', status: null, total: 0, status_transitions: { paid_at: null } },
        ],
      });

      const invoices = await gateway.listInvoices('cus_1', 24);

      expect(stripe.invoices.list).toHaveBeenCalledWith({ customer: 'cus_1', limit: 24 });
      expect(
        invoices.map(({ amount, ...rest }) => ({ ...rest, amount: amount.toFixed() })),
      ).toEqual([
        {
          id: 'in_2',
          status: 'paid',
          paidAt: new Date('2026-03-01T12:00:05.000Z'),
          amount: '199.9',
          hostedUrl: 'https://invoice.stripe.test/in_2',
        },
        { id: 'in_3', status: 'open', paidAt: null, amount: '99.9', hostedUrl: null },
        { id: 'in_4', status: 'draft', paidAt: null, amount: '0', hostedUrl: null },
      ]);
    });
  });

  describe('createBillingPortalSession (BR-012-10)', () => {
    it('opens the portal for the customer, with the configuration when there is one', async () => {
      const { gateway, stripe } = build();

      await expect(
        gateway.createBillingPortalSession({
          customerId: 'cus_1',
          returnUrl: 'https://app.example.test/office/plan',
          configurationId: 'bpc_1',
        }),
      ).resolves.toEqual({ url: 'https://billing.stripe.test/s' });
      await gateway.createBillingPortalSession({
        customerId: 'cus_1',
        returnUrl: 'https://app.example.test/office/plan',
      });

      expect(stripe.billingPortal.sessions.create.mock.calls).toEqual([
        [
          {
            customer: 'cus_1',
            return_url: 'https://app.example.test/office/plan',
            configuration: 'bpc_1',
          },
        ],
        [{ customer: 'cus_1', return_url: 'https://app.example.test/office/plan' }],
      ]);
    });
  });

  describe('getPrice (BR-012-02)', () => {
    it('answers the amount in reais, the interval, the currency and whether it is active', async () => {
      const { gateway, stripe } = build();
      stripe.prices.retrieve.mockResolvedValue({
        id: 'price_5',
        active: true,
        unit_amount: 19990,
        currency: 'brl',
        recurring: { interval: 'month' },
      });

      const price = await gateway.getPrice('price_5');

      expect(price).toMatchObject({
        id: 'price_5',
        active: true,
        interval: 'month',
        currency: 'brl',
      });
      expect(price?.amount.equals(new Decimal('199.9'))).toBe(true);
    });

    it('a one-off or metered price has no interval or a zero amount: it can never match a plan', async () => {
      const { gateway, stripe } = build();
      stripe.prices.retrieve.mockResolvedValue({
        id: 'price_x',
        active: true,
        unit_amount: null,
        currency: 'brl',
        recurring: null,
      });

      const price = await gateway.getPrice('price_x');

      expect(price?.interval).toBeNull();
      expect(price?.amount.isZero()).toBe(true);
    });

    it('answers null for a price that does not exist, and surfaces any other failure', async () => {
      const { gateway, stripe } = build();
      stripe.prices.retrieve.mockRejectedValue(
        Object.assign(new Error('No such price'), { code: 'resource_missing' }),
      );
      await expect(gateway.getPrice('price_nope')).resolves.toBeNull();

      stripe.prices.retrieve.mockRejectedValue(new Error('provider unreachable'));
      await expect(gateway.getPrice('price_5')).rejects.toThrow('provider unreachable');
    });
  });
});
