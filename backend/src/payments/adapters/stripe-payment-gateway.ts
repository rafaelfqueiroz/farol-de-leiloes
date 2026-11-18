// AR-10: the Stripe adapter of the PaymentGateway port — the only file in src/ that imports
// `stripe` (test/structural/payment-gateway.spec.ts) and, by AR-20, the only place an amount of
// reais becomes Stripe's integer centavos.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Env } from '../../config/env.js';
import { Decimal } from '../../common/money/money.js';
import {
  type CreateCustomerInput,
  type CreateFixedDiscountInput,
  type FixedDiscount,
  PaymentGateway,
  type PaymentEvent,
  type ProviderSubscription,
} from '../payment-gateway.js';

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

/** Stripe's whole seconds since the epoch → an instant; an absent value stays absent. */
function fromUnixSeconds(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

/** A Stripe reference that may be expanded into an object or left as its id. */
function idOf(reference: string | { id: string } | null | undefined): string | null {
  if (reference === null || reference === undefined) return null;
  return typeof reference === 'string' ? reference : reference.id;
}

/** The object of an expandable reference, or null when it was left as an id (or absent). */
function expanded<T extends object>(reference: string | T | null | undefined): T | null {
  return typeof reference === 'object' ? reference : null;
}

/** SPEC-012: the key we set on the provider's session and subscription to find our record. */
const SUBSCRIPTION_REF_KEY = 'subscriptionRef';

function refOf(metadata: Stripe.Metadata | null | undefined): string | null {
  const ref = metadata?.[SUBSCRIPTION_REF_KEY];
  return typeof ref === 'string' && ref.length > 0 ? ref : null;
}

/**
 * The subscription an invoice belongs to. Stripe API 2025+ moved it from `invoice.subscription`
 * to `invoice.parent.subscription_details.subscription`.
 */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription);
}

/**
 * The price of the phase that starts when the current one ends: a downgrade scheduled for the next
 * period (BR-012-17), or null when the subscription has no schedule or none is ahead.
 */
function nextPhaseOf(
  schedule: Stripe.SubscriptionSchedule,
): { priceId: string; startsAt: Date } | null {
  const current = schedule.current_phase;
  if (!current) return null;
  const next = schedule.phases.find((phase) => phase.start_date >= current.end_date);
  const item = next?.items[0];
  if (!next || !item) return null;
  const priceId = idOf(item.price);
  return priceId === null ? null : { priceId, startsAt: new Date(next.start_date * 1000) };
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

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId);
  }

  async retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    // The latest invoice says when payment was confirmed; the schedule holds a pending downgrade.
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice', 'schedule'],
    });
    const item = subscription.items.data[0];
    if (!item) {
      throw new Error('The provider subscription has no item');
    }
    const invoice = expanded(subscription.latest_invoice);
    const schedule = expanded(subscription.schedule);
    const next = schedule ? nextPhaseOf(schedule) : null;
    return {
      id: subscription.id,
      status: subscription.status,
      customerId: idOf(subscription.customer) ?? '',
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      // Stripe API 2025+ keeps the billing period on the item, not on the subscription.
      currentPeriodStart: fromUnixSeconds(item.current_period_start),
      currentPeriodEnd: fromUnixSeconds(item.current_period_end),
      priceId: item.price.id,
      scheduledPriceId: next?.priceId ?? null,
      scheduledChangeAt: next?.startsAt ?? null,
      latestInvoicePaidAt:
        invoice?.status === 'paid' ? fromUnixSeconds(invoice.status_transitions.paid_at) : null,
      subscriptionRef: refOf(subscription.metadata),
      canceledAt: fromUnixSeconds(subscription.canceled_at),
      endedAt: fromUnixSeconds(subscription.ended_at),
    };
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

    // SC-11 / BR-012-13: nothing but ids is taken from the payload. State is read again from the
    // provider (retrieveSubscription), so an event that is late, duplicated or out of order cannot
    // write stale state.
    const id = event.id;
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        return {
          id,
          type: 'checkout.completed',
          subscriptionId: idOf(session.subscription),
          subscriptionRef: refOf(session.metadata),
        };
      }
      case 'checkout.session.expired':
        return {
          id,
          type: 'checkout.expired',
          subscriptionRef: refOf(event.data.object.metadata),
        };
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return { id, type: 'subscription.changed', subscriptionId: event.data.object.id };
      case 'invoice.paid':
        return {
          id,
          type: 'invoice.paid',
          subscriptionId: invoiceSubscriptionId(event.data.object),
        };
      case 'invoice.payment_failed':
        return {
          id,
          type: 'invoice.payment_failed',
          subscriptionId: invoiceSubscriptionId(event.data.object),
        };
      default:
        return { id, type: 'unhandled', providerType: event.type };
    }
  }
}
