// AR-10: the Stripe adapter of the PaymentGateway port — the only file in src/ that imports
// `stripe` (test/structural/payment-gateway.spec.ts) and, by AR-20, the only place an amount of
// reais becomes Stripe's integer centavos.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Env } from '../../config/env';
import { Decimal } from '../../common/money/money';
import {
  type CreateCustomerInput,
  type CreateFixedDiscountInput,
  type CreateSubscriptionCheckoutInput,
  type FixedDiscount,
  PaymentGateway,
  type PaymentEvent,
} from '../payment-gateway';

/**
 * AR-20: reais → Stripe's integer centavos, exactly. A fraction of a centavo cannot be charged,
 * so it is refused rather than rounded away (a rounding here would silently change a price):
 *
 *   reaisToCentavos(new Decimal('10'))     → 1000
 *   reaisToCentavos(new Decimal('19.99'))  → 1999
 *   reaisToCentavos(new Decimal('0.005'))  → throws (half a centavo)
 */
export function reaisToCentavos(reais: Decimal): number {
  const centavos = reais.times(100);
  if (!centavos.isInteger()) {
    throw new RangeError('A Stripe amount cannot hold a fraction of a centavo');
  }
  if (centavos.isNegative() || centavos.greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('A Stripe amount must be a non-negative safe integer of centavos');
  }
  return centavos.toNumber();
}

/** Stripe expresses instants as whole seconds since the epoch. */
function toUnixSeconds(instant: Date): number {
  return Math.floor(instant.getTime() / 1000);
}

/** A Stripe reference that may be expanded into an object or left as its id. */
function idOf(reference: string | { id: string } | null): string | null {
  if (reference === null) return null;
  return typeof reference === 'string' ? reference : reference.id;
}

@Injectable()
export class StripePaymentGateway extends PaymentGateway {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(configService: ConfigService<Env, true>) {
    super();
    // AR-41: both values are required at boot, so neither can be missing here.
    this.stripe = new Stripe(configService.get('STRIPE_SECRET_KEY', { infer: true }));
    this.webhookSecret = configService.get('STRIPE_WEBHOOK_SECRET', { infer: true });
  }

  async createCustomer({ email, name, userId }: CreateCustomerInput): Promise<{ id: string }> {
    const customer = await this.stripe.customers.create({ email, name, metadata: { userId } });
    return { id: customer.id };
  }

  async createSubscriptionCheckout(
    input: CreateSubscriptionCheckoutInput,
  ): Promise<{ url: string | null }> {
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { userId: input.userId },
    };
    if (input.promotionCodeId) {
      params.discounts = [{ promotion_code: input.promotionCodeId }];
    }
    const session = await this.stripe.checkout.sessions.create(params);
    return { url: session.url };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId);
  }

  async createFixedDiscount({
    code,
    amountOff,
    expiresAt,
  }: CreateFixedDiscountInput): Promise<FixedDiscount> {
    const coupon = await this.stripe.coupons.create({
      amount_off: reaisToCentavos(amountOff), // AR-20
      currency: 'brl',
      duration: 'once',
      name: code,
    });
    const promotionCode = await this.stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: coupon.id },
      code,
      expires_at: toUnixSeconds(expiresAt),
      active: true,
    });
    return { couponId: coupon.id, promotionCodeId: promotionCode.id };
  }

  async deactivatePromotionCode(promotionCodeId: string): Promise<void> {
    await this.stripe.promotionCodes.update(promotionCodeId, { active: false });
  }

  parseWebhookEvent(rawBody: Buffer, signature: string): PaymentEvent {
    // SC-11: the signature covers the exact bytes Stripe sent; constructEvent throws otherwise.
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        return {
          type: 'checkout.completed',
          userId: session.metadata?.userId ?? null,
          subscriptionId: idOf(session.subscription),
        };
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        return {
          type: 'subscription.updated',
          customerId: idOf(subscription.customer),
          status: subscription.status,
        };
      }
      case 'customer.subscription.deleted':
        return {
          type: 'subscription.deleted',
          customerId: idOf(event.data.object.customer),
        };
      case 'invoice.payment_failed':
        return {
          type: 'invoice.payment_failed',
          customerId: idOf(event.data.object.customer),
        };
      default:
        return { type: 'unhandled', providerType: event.type };
    }
  }
}
