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
    customers: { create: vi.fn().mockResolvedValue({ id: 'cus_1' }), search: vi.fn() },
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
    invoices: { list: vi.fn(), voidInvoice: vi.fn().mockResolvedValue({}), retrieve: vi.fn() },
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

  describe('listSubscriptionInvoices (BR-012-29)', () => {
    it('reads EVERY invoice of the subscription with what each paid and what was already refunded, in reais', async () => {
      const { gateway, stripe } = build();
      stripe.invoices.list.mockResolvedValue({
        data: [
          {
            id: 'in_proration',
            status: 'paid',
            amount_paid: 8000,
            billing_reason: 'subscription_update',
          },
          {
            id: 'in_create',
            status: 'paid',
            amount_paid: 19990,
            billing_reason: 'subscription_create',
          },
          { id: 'in_open', status: 'open', amount_paid: 0, billing_reason: 'subscription_update' },
          { id: 'in_odd', status: null, amount_paid: 0, billing_reason: 'manual' },
        ],
      });
      stripe.invoicePayments.list.mockImplementation(({ invoice }: { invoice: string }) =>
        Promise.resolve({
          data: [
            {
              amount_paid: invoice === 'in_create' ? 19990 : 8000,
              payment: {
                type: 'payment_intent',
                payment_intent: {
                  id: `pi_${invoice}`,
                  latest_charge: { amount_refunded: invoice === 'in_create' ? 5000 : 0 },
                },
              },
            },
          ],
        }),
      );

      const invoices = await gateway.listSubscriptionInvoices('sub_1');

      expect(stripe.invoices.list).toHaveBeenCalledWith({ subscription: 'sub_1', limit: 100 });
      expect(
        invoices.map((invoice) => [
          invoice.id,
          invoice.reason,
          invoice.status,
          invoice.amountPaid.toFixed(),
          invoice.amountRefunded.toFixed(),
        ]),
      ).toEqual([
        ['in_proration', 'subscription_update', 'paid', '80', '0'],
        ['in_create', 'subscription_create', 'paid', '199.9', '50'],
        ['in_open', 'subscription_update', 'open', '0', '0'],
        ['in_odd', 'other', 'draft', '0', '0'],
      ]);
    });

    it('a paid invoice whose payment has no expanded charge counts nothing as refunded', async () => {
      const { gateway, stripe } = build();
      stripe.invoices.list.mockResolvedValue({
        data: [
          { id: 'in_1', status: 'paid', amount_paid: 1000, billing_reason: 'subscription_cycle' },
        ],
      });
      stripe.invoicePayments.list.mockResolvedValue({
        data: [
          { payment: { type: 'charge' } },
          { amount_paid: 1000, payment: { type: 'payment_intent', payment_intent: 'pi_1' } },
        ],
      });

      const [invoice] = await gateway.listSubscriptionInvoices('sub_1');

      expect(invoice?.amountRefunded.isZero()).toBe(true);
      expect(invoice?.reason).toBe('subscription_cycle');
    });

    it('a paid invoice with no payment intent at all counts nothing as refunded', async () => {
      const { gateway, stripe } = build();
      stripe.invoices.list.mockResolvedValue({
        data: [{ id: 'in_1', status: 'paid', amount_paid: 1000, billing_reason: null }],
      });
      stripe.invoicePayments.list.mockResolvedValue({ data: [] });

      const [invoice] = await gateway.listSubscriptionInvoices('sub_1');

      expect(invoice?.amountRefunded.isZero()).toBe(true);
    });
  });

  describe('refundInvoice (BR-012-29)', () => {
    const payment = (refunded: number, paid = 19990) => ({
      data: [
        {
          amount_paid: paid,
          payment: {
            type: 'payment_intent',
            payment_intent: {
              id: 'pi_1',
              latest_charge: { id: 'ch_1', amount_refunded: refunded },
            },
          },
        },
      ],
    });
    const input = { invoiceId: 'in_create', idempotencyKey: 'refund:ref_1:in_create' };

    it('refunds what remains of the invoice (paid minus refunded), with the stable key, answering it in reais', async () => {
      const { gateway, stripe } = build();
      stripe.invoicePayments.list.mockResolvedValue(payment(5000));

      const result = await gateway.refundInvoice(input);

      // 19990 paid - 5000 refunded = 14990 centavos = R$ 149,90
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        { payment_intent: 'pi_1', amount: 14990, reason: 'requested_by_customer' },
        { idempotencyKey: 'refund:ref_1:in_create' },
      );
      expect(result.refunded.equals(new Decimal('149.9'))).toBe(true);
    });

    it('nothing remains to give back: nothing is asked of the provider and zero is answered', async () => {
      const { gateway, stripe } = build();
      stripe.invoicePayments.list.mockResolvedValue(payment(19990));

      expect((await gateway.refundInvoice(input)).refunded.isZero()).toBe(true);
      expect(stripe.refunds.create).not.toHaveBeenCalled();
    });

    it.each(['idempotency_error', 'charge_already_refunded'])(
      'a %s counts as done only after the provider is read back and shows the invoice refunded in full',
      async (code) => {
        const { gateway, stripe } = build();
        stripe.invoicePayments.list
          .mockResolvedValueOnce(payment(0)) // before: nothing refunded
          .mockResolvedValueOnce(payment(19990)); // after the error: refunded in full
        stripe.refunds.create.mockRejectedValue(Object.assign(new Error('used'), { code }));

        const result = await gateway.refundInvoice(input);

        expect(result.refunded.equals(new Decimal('199.9'))).toBe(true);
      },
    );

    it('an idempotency error while the provider shows the invoice NOT refunded is not "done": it throws', async () => {
      const { gateway, stripe } = build();
      stripe.invoicePayments.list.mockResolvedValue(payment(0));
      stripe.refunds.create.mockRejectedValue(
        Object.assign(new Error('different parameters'), { code: 'idempotency_error' }),
      );

      await expect(gateway.refundInvoice(input)).rejects.toThrow('different parameters');
    });

    it('an idempotency error when the invoice vanished from the read-back throws too', async () => {
      const { gateway, stripe } = build();
      stripe.invoicePayments.list
        .mockResolvedValueOnce(payment(0))
        .mockResolvedValueOnce({ data: [] });
      stripe.refunds.create.mockRejectedValue(
        Object.assign(new Error('used'), { code: 'idempotency_error' }),
      );

      await expect(gateway.refundInvoice(input)).rejects.toThrow('used');
    });

    it('any other refund failure surfaces, so nothing is recorded as refunded', async () => {
      const { gateway, stripe } = build();
      stripe.invoicePayments.list.mockResolvedValue(payment(0));
      stripe.refunds.create.mockRejectedValue(new Error('provider unreachable'));

      await expect(gateway.refundInvoice(input)).rejects.toThrow('provider unreachable');
    });

    it('a paid invoice with no payment to refund is a fault', async () => {
      const { gateway, stripe } = build();
      stripe.invoicePayments.list.mockResolvedValue({ data: [{ payment: { type: 'charge' } }] });

      await expect(gateway.refundInvoice(input)).rejects.toThrow('no payment to refund');
    });
  });

  describe('voidInvoice (BR-012-29)', () => {
    it('voids an unpaid invoice', async () => {
      const { gateway, stripe } = build();

      await gateway.voidInvoice('in_open');

      expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_open');
    });

    it('an invoice that is already void is done; one that was paid meanwhile is NOT: the error surfaces', async () => {
      const { gateway, stripe } = build();
      stripe.invoices.voidInvoice.mockRejectedValue(new Error('cannot void'));

      stripe.invoices.retrieve.mockResolvedValue({ status: 'void' });
      await expect(gateway.voidInvoice('in_open')).resolves.toBeUndefined();
      stripe.invoices.retrieve.mockResolvedValue({ status: 'paid' });
      await expect(gateway.voidInvoice('in_open')).rejects.toThrow('cannot void');
      stripe.invoices.retrieve.mockRejectedValue(new Error('unreachable'));
      await expect(gateway.voidInvoice('in_open')).rejects.toThrow('cannot void');
    });
  });

  describe('retrieveCheckoutSession (ADR-005)', () => {
    it.each([
      ['complete', 'complete'],
      ['expired', 'expired'],
      ['open', 'open'],
      [null, 'open'],
    ])(
      'maps the provider status %s to %s, with the subscription it created',
      async (status, state) => {
        const { gateway, stripe } = build();
        stripe.checkout.sessions.retrieve.mockResolvedValue({ status, subscription: 'sub_9' });

        await expect(gateway.retrieveCheckoutSession('cs_1')).resolves.toEqual({
          state,
          subscriptionId: 'sub_9',
        });
      },
    );

    it('has no subscription until the buyer paid', async () => {
      const { gateway, stripe } = build();
      stripe.checkout.sessions.retrieve.mockResolvedValue({ status: 'open', subscription: null });

      expect((await gateway.retrieveCheckoutSession('cs_1')).subscriptionId).toBeNull();
    });
  });

  describe('findCustomerByUserId (one customer per buyer)', () => {
    const userId = '64b7f0000000000000000b01';

    it('looks the customer up by our user id in its metadata', async () => {
      const { gateway, stripe } = build();
      stripe.customers.search.mockResolvedValue({ data: [{ id: 'cus_known' }] });

      await expect(gateway.findCustomerByUserId(userId)).resolves.toBe('cus_known');

      expect(stripe.customers.search).toHaveBeenCalledWith({
        query: `metadata['userId']:'${userId}'`,
        limit: 1,
      });
    });

    it('answers null when there is none, and never builds a query from a value that is not an id', async () => {
      const { gateway, stripe } = build();
      stripe.customers.search.mockResolvedValue({ data: [] });

      await expect(gateway.findCustomerByUserId(userId)).resolves.toBeNull();
      await expect(gateway.findCustomerByUserId("x' OR metadata['a']:'b")).resolves.toBeNull();

      expect(stripe.customers.search).toHaveBeenCalledTimes(1);
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
        billing_scheme: 'tiered',
        recurring: null,
      });

      const price = await gateway.getPrice('price_x');

      expect(price).toMatchObject({
        interval: null,
        intervalCount: null,
        licensed: false,
        perUnit: false,
      });
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
