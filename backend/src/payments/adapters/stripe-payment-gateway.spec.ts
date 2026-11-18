// AR-20: the Stripe adapter is the one place reais become integer centavos, and it refuses a
// fraction of a centavo instead of rounding it away. The Stripe client is replaced with a stub
// that records calls, so nothing reaches Stripe (TS-07); the webhook mapping is driven by real
// signatures computed locally with Stripe's own test helper over a fake secret.
import { describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { Decimal } from '../../common/money/money.js';
import { reaisToCentavos, StripePaymentGateway } from './stripe-payment-gateway.js';
import { testConfigService, TEST_ENV } from '../../../test/support/test-env.js';

describe('reaisToCentavos (AR-20)', () => {
  it.each([
    ['10', 1000],
    ['10.00', 1000],
    ['19.99', 1999],
    ['0.01', 1],
    ['0', 0],
    ['1234567.89', 123456789],
    // 0.1 + 0.2 in Decimal is exactly 0.3: 30 centavos, where a float would give 30.000000000000004.
    [new Decimal('0.1').plus('0.2').toFixed(), 30],
  ])('R$ %s → %i centavos', (reais, centavos) => {
    expect(reaisToCentavos(new Decimal(reais))).toBe(centavos);
  });

  it.each(['0.005', '10.001', '19.999'])('refuses %s: a fraction of a centavo', (reais) => {
    expect(() => reaisToCentavos(new Decimal(reais))).toThrow(RangeError);
  });

  it('refuses a negative amount and one beyond a safe integer of centavos', () => {
    expect(() => reaisToCentavos(new Decimal('-1'))).toThrow(RangeError);
    expect(() => reaisToCentavos(new Decimal('90071992547409.92'))).toThrow(RangeError);
  });
});

describe('StripePaymentGateway', () => {
  function build() {
    const gateway = new StripePaymentGateway(testConfigService());
    const stripe = {
      coupons: { create: vi.fn().mockResolvedValue({ id: 'coupon_1' }) },
      promotionCodes: {
        create: vi.fn().mockResolvedValue({ id: 'promo_1' }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    // The client is private and read-only; swap it for the stub that records the calls.
    Object.assign(gateway, { stripe });
    return { gateway, stripe };
  }

  it('createFixedDiscount sends Stripe centavos and the expiry in seconds', async () => {
    const { gateway, stripe } = build();

    await expect(
      gateway.createFixedDiscount({
        code: 'BEMVINDO',
        amountOff: new Decimal('25.50'),
        expiresAt: new Date('2026-12-31T03:00:00.000Z'),
      }),
    ).resolves.toEqual({ couponId: 'coupon_1', promotionCodeId: 'promo_1' });

    expect(stripe.coupons.create).toHaveBeenCalledWith({
      amount_off: 2550, // R$ 25,50 = 2,550 centavos
      currency: 'brl',
      duration: 'once',
      name: 'BEMVINDO',
    });
    expect(stripe.promotionCodes.create).toHaveBeenCalledWith({
      promotion: { type: 'coupon', coupon: 'coupon_1' },
      code: 'BEMVINDO',
      expires_at: 1798686000, // 2026-12-31T03:00:00Z
      active: true,
    });
  });

  it('createFixedDiscount creates nothing at Stripe for a sub-centavo amount', async () => {
    const { gateway, stripe } = build();

    await expect(
      gateway.createFixedDiscount({
        code: 'X',
        amountOff: new Decimal('0.005'),
        expiresAt: new Date('2026-12-31T03:00:00.000Z'),
      }),
    ).rejects.toThrow(RangeError);
    expect(stripe.coupons.create).not.toHaveBeenCalled();
  });

  describe('retrieveSubscription (BR-012-13)', () => {
    // Stripe API 2025+: the billing period is on the item, the ref in the metadata.
    const stripeSubscription = (overrides: Record<string, unknown> = {}) => ({
      id: 'sub_1',
      status: 'active',
      customer: 'cus_1',
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
      metadata: { subscriptionRef: 'ref_1' },
      latest_invoice: { status: 'paid', status_transitions: { paid_at: 1_768_046_405 } },
      schedule: null,
      items: {
        data: [
          {
            price: { id: 'price_5' },
            current_period_start: 1_768_046_400, // 2026-01-10T12:00:00Z
            current_period_end: 1_770_724_800, // 2026-02-10T12:00:00Z
          },
        ],
      },
      ...overrides,
    });

    function build(subscription: Record<string, unknown>) {
      const gateway = new StripePaymentGateway(testConfigService());
      const retrieve = vi.fn().mockResolvedValue(subscription);
      Object.assign(gateway, { stripe: { subscriptions: { retrieve } } });
      return { gateway, retrieve };
    }

    it('reads the subscription with its latest invoice and schedule, as instants', async () => {
      const { gateway, retrieve } = build(stripeSubscription());

      await expect(gateway.retrieveSubscription('sub_1')).resolves.toEqual({
        id: 'sub_1',
        status: 'active',
        customerId: 'cus_1',
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date('2026-01-10T12:00:00.000Z'),
        currentPeriodEnd: new Date('2026-02-10T12:00:00.000Z'),
        priceId: 'price_5',
        scheduledPriceId: null,
        scheduledChangeAt: null,
        latestInvoicePaidAt: new Date('2026-01-10T12:00:05.000Z'),
        subscriptionRef: 'ref_1',
        canceledAt: null,
        endedAt: null,
      });
      expect(retrieve).toHaveBeenCalledWith('sub_1', { expand: ['latest_invoice', 'schedule'] });
    });

    it('BR-012-17: reads the next phase of the schedule as the scheduled downgrade', async () => {
      const { gateway } = build(
        stripeSubscription({
          schedule: {
            current_phase: { start_date: 1_768_046_400, end_date: 1_770_724_800 },
            phases: [
              { start_date: 1_768_046_400, end_date: 1_770_724_800, items: [{ price: 'price_5' }] },
              {
                start_date: 1_770_724_800,
                end_date: 1_773_144_000,
                items: [{ price: { id: 'price_2' } }],
              },
            ],
          },
        }),
      );

      await expect(gateway.retrieveSubscription('sub_1')).resolves.toMatchObject({
        scheduledPriceId: 'price_2',
        scheduledChangeAt: new Date('2026-02-10T12:00:00.000Z'),
      });
    });

    it.each([
      [
        'a schedule with no phase ahead',
        {
          current_phase: { start_date: 1, end_date: 5 },
          phases: [{ start_date: 1, end_date: 5, items: [{ price: 'price_5' }] }],
        },
      ],
      ['a schedule not in a phase', { current_phase: null, phases: [] }],
      [
        'a next phase with no item',
        {
          current_phase: { start_date: 1, end_date: 5 },
          phases: [{ start_date: 5, end_date: 9, items: [] }],
        },
      ],
      ['a schedule left as an id', 'sub_sched_1'],
    ])('has no scheduled change for %s', async (_label, schedule) => {
      const { gateway } = build(stripeSubscription({ schedule }));

      await expect(gateway.retrieveSubscription('sub_1')).resolves.toMatchObject({
        scheduledPriceId: null,
        scheduledChangeAt: null,
      });
    });

    it('says not paid for an open invoice, and keeps the cancellation and end instants', async () => {
      const { gateway } = build(
        stripeSubscription({
          status: 'canceled',
          cancel_at_period_end: true,
          canceled_at: 1_768_046_400,
          ended_at: 1_770_724_800,
          latest_invoice: { status: 'open', status_transitions: { paid_at: null } },
        }),
      );

      await expect(gateway.retrieveSubscription('sub_1')).resolves.toMatchObject({
        status: 'canceled',
        cancelAtPeriodEnd: true,
        latestInvoicePaidAt: null,
        canceledAt: new Date('2026-01-10T12:00:00.000Z'),
        endedAt: new Date('2026-02-10T12:00:00.000Z'),
      });
    });

    it('has no ref when the metadata lacks it, and reads an expanded customer', async () => {
      const { gateway } = build(
        stripeSubscription({ metadata: {}, customer: { id: 'cus_2' }, latest_invoice: 'in_1' }),
      );

      await expect(gateway.retrieveSubscription('sub_1')).resolves.toMatchObject({
        subscriptionRef: null,
        customerId: 'cus_2',
        latestInvoicePaidAt: null,
      });
    });

    it('refuses a subscription with no item: a fault, never a guess of the price', async () => {
      const { gateway } = build(stripeSubscription({ items: { data: [] } }));

      await expect(gateway.retrieveSubscription('sub_1')).rejects.toThrow('no item');
    });
  });

  describe('parseWebhookEvent', () => {
    const gateway = new StripePaymentGateway(testConfigService());
    const signer = new Stripe(TEST_ENV.STRIPE_SECRET_KEY);

    function signed(type: string, object: Record<string, unknown>) {
      const payload = JSON.stringify({ id: 'evt_1', object: 'event', type, data: { object } });
      const signature = signer.webhooks.generateTestHeaderString({
        payload,
        secret: TEST_ENV.STRIPE_WEBHOOK_SECRET,
      });
      return gateway.parseWebhookEvent(Buffer.from(payload), signature);
    }

    it('maps the events the product acts on into the port vocabulary, ids only', () => {
      expect(
        signed('checkout.session.completed', {
          subscription: 'sub_1',
          metadata: { subscriptionRef: 'ref_1' },
        }),
      ).toEqual({
        id: 'evt_1',
        type: 'checkout.completed',
        subscriptionId: 'sub_1',
        subscriptionRef: 'ref_1',
      });
      // An expanded subscription, and a legacy session without our ref (BR-012-13).
      expect(
        signed('checkout.session.completed', { subscription: { id: 'sub_2' }, metadata: null }),
      ).toEqual({
        id: 'evt_1',
        type: 'checkout.completed',
        subscriptionId: 'sub_2',
        subscriptionRef: null,
      });
      expect(
        signed('checkout.session.expired', { metadata: { subscriptionRef: 'ref_2' } }),
      ).toEqual({ id: 'evt_1', type: 'checkout.expired', subscriptionRef: 'ref_2' });
      for (const type of [
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
      ]) {
        // The status in the payload is not carried: the state is read again (BR-012-13).
        expect(signed(type, { id: 'sub_3', status: 'canceled', customer: 'cus_1' })).toEqual({
          id: 'evt_1',
          type: 'subscription.changed',
          subscriptionId: 'sub_3',
        });
      }
      const invoice = (subscription: string | null) => ({
        parent: subscription ? { subscription_details: { subscription } } : null,
      });
      expect(signed('invoice.paid', invoice('sub_4'))).toEqual({
        id: 'evt_1',
        type: 'invoice.paid',
        subscriptionId: 'sub_4',
      });
      expect(signed('invoice.payment_failed', invoice('sub_5'))).toEqual({
        id: 'evt_1',
        type: 'invoice.payment_failed',
        subscriptionId: 'sub_5',
      });
      expect(signed('invoice.payment_failed', invoice(null))).toEqual({
        id: 'evt_1',
        type: 'invoice.payment_failed',
        subscriptionId: null,
      });
      expect(signed('charge.refunded', {})).toEqual({
        id: 'evt_1',
        type: 'unhandled',
        providerType: 'charge.refunded',
      });
    });

    it('throws on a signature that does not cover the body', () => {
      expect(() => gateway.parseWebhookEvent(Buffer.from('{}'), 't=1,v1=00')).toThrow();
    });
  });
});
