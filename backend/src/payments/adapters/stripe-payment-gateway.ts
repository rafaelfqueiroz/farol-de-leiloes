// AR-10: the Stripe adapter of the PaymentGateway port — the only file in src/ that imports
// `stripe` (test/structural/payment-gateway.spec.ts) and, by AR-20, the only place an amount of
// reais becomes Stripe's integer centavos.
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Env } from '../../config/env.js';
import { Decimal } from '../../common/money/money.js';
import {
  type ChangePriceInput,
  type CheckoutSession,
  type CreateBillingPortalSessionInput,
  type CreateCustomerInput,
  type CreateFixedDiscountInput,
  type CreateOfficeCheckoutInput,
  type FixedDiscount,
  PaymentGateway,
  type PaymentEvent,
  type InvoiceReason,
  type PlanChangePreview,
  type PreviewPlanChangeInput,
  type ProviderCheckoutSession,
  type ProviderInvoice,
  type ProviderPrice,
  type ProviderSubscription,
  type RefundInvoiceInput,
  type RefundResult,
  type SetCancelAtPeriodEndInput,
  type SubscriptionInvoice,
  WebhookSignatureError,
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

/** AR-20: centavos → reais, exactly (the inverse of `reaisToCentavos`). */
export function centavosToReais(centavos: number): Decimal {
  return new Decimal(centavos).dividedBy(100);
}

/** The provider's error code of a failed request, if it is one. */
function stripeErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** The one item of a single-item subscription (the only shape we sell). */
function onlyItem(subscription: Stripe.Subscription): Stripe.SubscriptionItem {
  const [item, ...others] = subscription.items.data;
  if (!item || others.length > 0) {
    throw new Error('The provider subscription does not have exactly one item');
  }
  return item;
}

/** Why an invoice was issued, reduced to the reasons SPEC-012 tells apart. */
function invoiceReasonOf(reason: Stripe.Invoice.BillingReason | null): InvoiceReason {
  return reason === 'subscription_create' ||
    reason === 'subscription_cycle' ||
    reason === 'subscription_update'
    ? reason
    : 'other';
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

/**
 * ADR-005: the provider is read INSIDE a sync lease of SYNC_LEASE_MS (30 s). A request must be
 * over before the lease is: 8 s per attempt, 2 retries after a network failure, so even the worst
 * case (3 attempts, 24 s, and a second or so of backoff) ends first. A spec ties this to the lease.
 */
export const STRIPE_REQUEST_TIMEOUT_MS = 8_000;
export const STRIPE_MAX_NETWORK_RETRIES = 2;
export const STRIPE_WORST_CASE_MS = STRIPE_REQUEST_TIMEOUT_MS * (STRIPE_MAX_NETWORK_RETRIES + 1);

@Injectable()
export class StripePaymentGateway extends PaymentGateway {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;
  /** The mode of the configured key: an event of the other mode is not ours to act on. */
  private readonly liveMode: boolean;
  private readonly logger = new Logger(StripePaymentGateway.name);

  constructor(configService: ConfigService<Env, true>) {
    super();
    // AR-41: both values are required at boot, so neither can be missing here.
    const secretKey = configService.get('STRIPE_SECRET_KEY', { infer: true });
    this.stripe = new Stripe(secretKey, {
      timeout: STRIPE_REQUEST_TIMEOUT_MS,
      maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
    });
    this.liveMode = /^(sk|rk)_live_/.test(secretKey);
    this.webhookSecret = configService.get('STRIPE_WEBHOOK_SECRET', { infer: true });
  }

  async createCustomer({
    email,
    name,
    userId,
    idempotencyKey,
  }: CreateCustomerInput): Promise<{ id: string }> {
    const customer = await this.stripe.customers.create(
      { email, name, metadata: { userId } },
      idempotencyKey === undefined ? undefined : { idempotencyKey },
    );
    return { id: customer.id };
  }

  async createOfficeCheckout(input: CreateOfficeCheckoutInput): Promise<CheckoutSession> {
    const metadata = { [SUBSCRIPTION_REF_KEY]: input.subscriptionRef };
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        ...(input.promotionCodeId === undefined
          ? {}
          : { discounts: [{ promotion_code: input.promotionCodeId }] }),
        // ADR-005: the ref on BOTH objects, so whichever event arrives first finds our record.
        metadata,
        subscription_data: { metadata },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: toUnixSeconds(input.expiresAt),
        locale: 'pt-BR',
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (!session.url) throw new Error('The provider answered a checkout session without a URL');
    return { sessionId: session.id, url: session.url };
  }

  async expireCheckoutSession(sessionId: string): Promise<'expired' | 'completed'> {
    try {
      await this.stripe.checkout.sessions.expire(sessionId);
      return 'expired';
    } catch (error) {
      // Only an open session can be expired: say what the session is, or let the fault surface.
      const session = await this.stripe.checkout.sessions.retrieve(sessionId).catch(() => null);
      if (session?.status === 'expired') return 'expired';
      if (session?.status === 'complete') return 'completed';
      throw error;
    }
  }

  async changeSubscriptionPrice({
    subscriptionId,
    priceId,
    idempotencyKey,
  }: ChangePriceInput): Promise<void> {
    const item = onlyItem(await this.stripe.subscriptions.retrieve(subscriptionId));
    await this.stripe.subscriptions.update(
      subscriptionId,
      {
        items: [{ id: item.id, price: priceId }],
        // BR-012-16: the prorated difference is invoiced now, and the price changes only once it
        // is paid (a pending update): the plan and the limit follow the paid price.
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
      },
      { idempotencyKey },
    );
  }

  async previewPlanChange({
    subscriptionId,
    priceId,
  }: PreviewPlanChangeInput): Promise<PlanChangePreview> {
    const item = onlyItem(await this.stripe.subscriptions.retrieve(subscriptionId));
    // The provider's upcoming invoice with the SAME proration the upgrade uses (BR-012-16), so the
    // figure shown is the one it would charge. Read only: no invoice, item or schedule is created.
    const invoice = await this.stripe.invoices.createPreview({
      subscription: subscriptionId,
      subscription_details: {
        items: [{ id: item.id, price: priceId }],
        proration_behavior: 'always_invoice',
      },
    });
    const lines = invoice.lines.data;
    const periodEnds = lines
      .filter((line) => line.amount > 0)
      .map((line) => line.period.end)
      .sort((a, b) => b - a);
    return {
      // AR-20: centavos become reais here and nowhere else. A credit is never paid out.
      amountDue: centavosToReais(Math.max(invoice.amount_due, 0)),
      currency: invoice.currency,
      lines: lines.map((line) => ({ amount: centavosToReais(line.amount) })),
      nextChargeAt: fromUnixSeconds(periodEnds[0]),
    };
  }

  async scheduleSubscriptionPrice({
    subscriptionId,
    priceId,
    idempotencyKey,
  }: ChangePriceInput): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['schedule'],
    });
    const item = onlyItem(subscription);
    const price = await this.stripe.prices.retrieve(priceId);
    const interval = price.recurring?.interval;
    if (interval !== 'month' && interval !== 'year') {
      throw new Error('A scheduled plan must be a monthly or yearly price');
    }
    const existing = expanded(subscription.schedule);
    const schedule =
      existing ??
      (await this.stripe.subscriptionSchedules.create(
        { from_subscription: subscriptionId },
        { idempotencyKey: `${idempotencyKey}:schedule` },
      ));
    const phase = schedule.current_phase;
    if (!phase) throw new Error('The provider schedule has no current phase');
    await this.stripe.subscriptionSchedules.update(
      schedule.id,
      {
        // BR-012-17: the current price until the period ends, then the new one; afterwards the
        // schedule lets go and the subscription simply continues on the new price.
        phases: [
          {
            items: [{ price: item.price.id, quantity: 1 }],
            start_date: phase.start_date,
            end_date: phase.end_date,
          },
          { items: [{ price: priceId, quantity: 1 }], duration: { interval, interval_count: 1 } },
        ],
        end_behavior: 'release',
        proration_behavior: 'none',
      },
      { idempotencyKey },
    );
  }

  async releaseScheduledChange(subscriptionId: string, idempotencyKey: string): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    const scheduleId = idOf(subscription.schedule);
    if (scheduleId === null) return; // nothing scheduled: already as asked
    try {
      await this.stripe.subscriptionSchedules.release(scheduleId, undefined, { idempotencyKey });
    } catch (error) {
      // A schedule already released (a replay, or two members at once) is a success.
      const current = await this.stripe.subscriptionSchedules
        .retrieve(scheduleId)
        .catch(() => null);
      if (current?.status === 'released' || current?.status === 'canceled') return;
      throw error;
    }
  }

  async setCancelAtPeriodEnd({
    subscriptionId,
    cancel,
    idempotencyKey,
  }: SetCancelAtPeriodEndInput): Promise<void> {
    await this.stripe.subscriptions.update(
      subscriptionId,
      { cancel_at_period_end: cancel },
      { idempotencyKey },
    );
  }

  async listSubscriptionInvoices(subscriptionId: string): Promise<SubscriptionInvoice[]> {
    const invoices = await this.stripe.invoices.list({ subscription: subscriptionId, limit: 100 });
    return Promise.all(
      invoices.data.map(async (invoice) => {
        // Only a paid invoice can have been refunded: read the charge it was paid by.
        const refunded =
          invoice.status === 'paid' && invoice.amount_paid > 0
            ? ((await this.paidPaymentOf(invoice.id))?.charge?.amount_refunded ?? 0)
            : 0;
        return {
          id: invoice.id,
          reason: invoiceReasonOf(invoice.billing_reason),
          status: invoice.status ?? 'draft',
          amountPaid: centavosToReais(invoice.amount_paid),
          amountRefunded: centavosToReais(refunded),
        };
      }),
    );
  }

  /** The paid payment of an invoice with its payment intent and charge (expanded). */
  private async paidPaymentOf(invoiceId: string): Promise<{
    intentId: string;
    amountPaid: number;
    charge: Stripe.Charge | null;
  } | null> {
    const payments = await this.stripe.invoicePayments.list({
      invoice: invoiceId,
      status: 'paid',
      expand: ['data.payment.payment_intent.latest_charge'],
    });
    for (const entry of payments.data) {
      if (entry.payment.type !== 'payment_intent') continue;
      const intent = expanded(entry.payment.payment_intent);
      const intentId = intent?.id ?? idOf(entry.payment.payment_intent);
      if (intentId === null) continue;
      return {
        intentId,
        amountPaid: entry.amount_paid ?? 0,
        charge: expanded(intent?.latest_charge),
      };
    }
    return null;
  }

  async refundInvoice({ invoiceId, idempotencyKey }: RefundInvoiceInput): Promise<RefundResult> {
    const payment = await this.paidPaymentOf(invoiceId);
    if (payment === null) throw new Error('The paid invoice has no payment to refund');
    const refundedSoFar = payment.charge?.amount_refunded ?? 0;
    const remaining = payment.amountPaid - refundedSoFar;
    if (remaining <= 0) return { refunded: new Decimal(0) }; // nothing remained: already given back
    try {
      await this.stripe.refunds.create(
        { payment_intent: payment.intentId, amount: remaining, reason: 'requested_by_customer' },
        { idempotencyKey },
      );
    } catch (error) {
      // The key was used before (a run that crashed after the refund) or the charge was already
      // refunded: that is "done" only if the provider itself shows the invoice refunded in full.
      const code = stripeErrorCode(error);
      if (code !== 'idempotency_error' && code !== 'charge_already_refunded') throw error;
      const after = await this.paidPaymentOf(invoiceId);
      if (after !== null && after.amountPaid - (after.charge?.amount_refunded ?? 0) <= 0) {
        return { refunded: centavosToReais(remaining) };
      }
      throw error;
    }
    return { refunded: centavosToReais(remaining) };
  }

  async voidInvoice(invoiceId: string): Promise<void> {
    try {
      await this.stripe.invoices.voidInvoice(invoiceId);
    } catch (error) {
      // Paid meanwhile is NOT void: the caller reads the invoices again. Already void is done.
      const current = await this.stripe.invoices.retrieve(invoiceId).catch(() => null);
      if (current?.status === 'void') return;
      throw error;
    }
  }

  async retrieveCheckoutSession(sessionId: string): Promise<ProviderCheckoutSession> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    return {
      state:
        session.status === 'complete' || session.status === 'expired' ? session.status : 'open',
      subscriptionId: idOf(session.subscription),
    };
  }

  async findCustomerByUserId(userId: string): Promise<string | null> {
    // userId is OUR ObjectId (hex): it cannot carry a quote, and the query is built from it alone.
    if (!/^[0-9a-f]{24}$/.test(userId)) return null;
    const found = await this.stripe.customers.search({
      query: `metadata['userId']:'${userId}'`,
      limit: 1,
    });
    return found.data[0]?.id ?? null;
  }

  async listInvoices(customerId: string, limit: number): Promise<ProviderInvoice[]> {
    const invoices = await this.stripe.invoices.list({ customer: customerId, limit });
    return invoices.data.map((invoice) => ({
      id: invoice.id,
      reason: invoiceReasonOf(invoice.billing_reason),
      // The service period is the first line's; the invoice's own period fields are another thing.
      periodStart: fromUnixSeconds(invoice.lines?.data[0]?.period.start),
      periodEnd: fromUnixSeconds(invoice.lines?.data[0]?.period.end),
      paidAt:
        invoice.status === 'paid' ? fromUnixSeconds(invoice.status_transitions.paid_at) : null,
      // The invoice's total after discounts; AR-20: centavos become reais here and nowhere else.
      amount: centavosToReais(invoice.total),
      status: invoice.status ?? 'draft',
      hostedUrl: invoice.hosted_invoice_url ?? null,
    }));
  }

  async createBillingPortalSession({
    customerId,
    returnUrl,
    configurationId,
  }: CreateBillingPortalSessionInput): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      ...(configurationId === undefined ? {} : { configuration: configurationId }),
    });
    return { url: session.url };
  }

  async getPrice(priceId: string): Promise<ProviderPrice | null> {
    try {
      const price = await this.stripe.prices.retrieve(priceId);
      return {
        id: price.id,
        active: price.active,
        // A price without a fixed amount (metered, tiered) is not a plan price: 0 never matches.
        amount: centavosToReais(price.unit_amount ?? 0),
        interval: price.recurring?.interval ?? null,
        intervalCount: price.recurring?.interval_count ?? null,
        licensed: price.recurring?.usage_type === 'licensed',
        perUnit: price.billing_scheme === 'per_unit',
        currency: price.currency,
      };
    } catch (error) {
      if (stripeErrorCode(error) === 'resource_missing') return null;
      throw error;
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      await this.stripe.subscriptions.cancel(subscriptionId);
    } catch (error) {
      // Idempotent (BR-012-08): two cancels racing, or a replay, find it already canceled.
      const current = await this.stripe.subscriptions.retrieve(subscriptionId).catch(() => null);
      if (current?.status === 'canceled') return;
      throw error;
    }
  }

  async retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    // The latest invoice says when payment was confirmed; the schedule holds a pending downgrade.
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice', 'schedule'],
    });
    // We only sell single-item subscriptions: another shape is a fault, never a guess of the price.
    const [item, ...others] = subscription.items.data;
    if (!item || others.length > 0) {
      throw new Error('The provider subscription does not have exactly one item');
    }
    const first = await this.firstInvoiceOf(subscription);
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
      // BR-012-29, DL-012-10: the first payment is the invoice that CREATED the subscription,
      // not the latest one (an upgrade's proration or a renewal is another payment).
      firstInvoicePaidAt:
        first?.status === 'paid' ? fromUnixSeconds(first.status_transitions.paid_at) : null,
      firstInvoiceFree: first?.status === 'paid' && first.amount_paid === 0,
      subscriptionRef: refOf(subscription.metadata),
      canceledAt: fromUnixSeconds(subscription.canceled_at),
      endedAt: fromUnixSeconds(subscription.ended_at),
    };
  }

  /**
   * The `subscription_create` invoice of a subscription. It is the latest invoice until the first
   * renewal or change; after that it is looked for among the subscription's invoices.
   */
  private async firstInvoiceOf(subscription: Stripe.Subscription): Promise<Stripe.Invoice | null> {
    const latest = expanded(subscription.latest_invoice);
    if (latest?.billing_reason === 'subscription_create') return latest;
    const invoices = await this.stripe.invoices.list({ subscription: subscription.id, limit: 100 });
    return (
      invoices.data.find((invoice) => invoice.billing_reason === 'subscription_create') ?? null
    );
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
    // Only this step is an invalid request; the mapping below is ours, and a fault there is a 5xx.
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch {
      throw new WebhookSignatureError();
    }
    // A test event never touches a live deployment, nor the other way round. The event is
    // acknowledged (a retry would change nothing); the warning names the event id only.
    if (event.livemode !== this.liveMode) {
      this.logger.warn(`Webhook event ${event.id} is of the other mode than the key: ignored`);
      return { id: event.id, type: 'unhandled', providerType: event.type };
    }

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
        return { id, type: 'checkout.expired', checkoutSessionId: event.data.object.id };
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
