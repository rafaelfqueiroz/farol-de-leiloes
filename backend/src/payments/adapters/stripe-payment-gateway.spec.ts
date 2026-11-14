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

    it('maps the events the product acts on into the port vocabulary', () => {
      expect(
        signed('checkout.session.completed', {
          subscription: 'sub_1',
          metadata: { userId: 'u1' },
        }),
      ).toEqual({ type: 'checkout.completed', userId: 'u1', subscriptionId: 'sub_1' });
      expect(
        signed('checkout.session.completed', { subscription: { id: 'sub_2' }, metadata: null }),
      ).toEqual({ type: 'checkout.completed', userId: null, subscriptionId: 'sub_2' });
      expect(
        signed('customer.subscription.updated', { customer: 'cus_1', status: 'past_due' }),
      ).toEqual({ type: 'subscription.updated', customerId: 'cus_1', status: 'past_due' });
      expect(signed('customer.subscription.deleted', { customer: { id: 'cus_2' } })).toEqual({
        type: 'subscription.deleted',
        customerId: 'cus_2',
      });
      expect(signed('invoice.payment_failed', { customer: null })).toEqual({
        type: 'invoice.payment_failed',
        customerId: null,
      });
      expect(signed('charge.refunded', {})).toEqual({
        type: 'unhandled',
        providerType: 'charge.refunded',
      });
    });

    it('throws on a signature that does not cover the body', () => {
      expect(() => gateway.parseWebhookEvent(Buffer.from('{}'), 't=1,v1=00')).toThrow();
    });
  });
});
