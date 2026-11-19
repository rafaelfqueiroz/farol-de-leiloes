// AR-10: the payment provider behind a port named for its role. Services (SubscriptionsService,
// CouponsService) depend on this class only; StripePaymentGateway is the one adapter, the only
// file that imports `stripe` (a structural test holds it to that) and the only place money
// becomes integer centavos (AR-20). Everything crossing the port is in OUR vocabulary: instants
// are `Date`, amounts are reais as `Decimal`, ids are the provider's opaque strings. Tests use
// FakePaymentGateway (TS-03).
//
// SPEC-012 (ADR-005): the provider is the source of truth for a subscription. A webhook event only
// says "something changed for this subscription"; the service re-reads it with
// `retrieveSubscription` and stores what the provider says now (BR-012-13).
//
// BR-012-29 (DL-012-10): "a full refund of what it paid" is every paid invoice of the first
// subscription minus what was refunded, read with `listSubscriptionInvoices` and given back with
// `refundInvoice`, one key per invoice; the first payment is the `subscription_create` invoice,
// never `latest_invoice`.
import type { Decimal } from '../common/money/money.js';

export interface CreateCustomerInput {
  email: string;
  name: string;
  /** Our user id, kept on the provider's customer so its events can be traced back. */
  userId: string;
  /** The provider deduplicates a repeated call with the same key (a retried checkout). */
  idempotencyKey?: string;
}

/** SPEC-012 BR-012-06, BR-012-10: a hosted checkout for a new office subscription. */
export interface CreateOfficeCheckoutInput {
  customerId: string;
  /** The provider's price of the chosen plan. */
  priceId: string;
  /** A promotion code (SPEC-026), for a NEW subscription only (BR-026-08). */
  promotionCodeId?: string;
  /**
   * Our subscription ref: set on the session AND on the subscription it creates, so a provider
   * event can be traced back to our record whichever arrives first (ADR-005).
   */
  subscriptionRef: string;
  successUrl: string;
  cancelUrl: string;
  /** The session stops accepting payment at this instant. */
  expiresAt: Date;
  idempotencyKey: string;
}

/** The hosted checkout page: where to send the buyer, and the session that names it. */
export interface CheckoutSession {
  readonly sessionId: string;
  readonly url: string;
}

/** SPEC-012 BR-012-16/17: moves a subscription to another price. */
export interface ChangePriceInput {
  subscriptionId: string;
  priceId: string;
  idempotencyKey: string;
}

/** SPEC-012 BR-012-19: stops or resumes renewal. */
export interface SetCancelAtPeriodEndInput {
  subscriptionId: string;
  cancel: boolean;
  idempotencyKey: string;
}

/** Why the provider issued an invoice (the ones SPEC-012 tells apart). */
export type InvoiceReason =
  'subscription_create' | 'subscription_cycle' | 'subscription_update' | 'other';

/**
 * SPEC-012 BR-012-29: one invoice of a subscription as the refund reads it. `amountPaid` is what
 * the customer paid for it (after discounts, zero for a 100% coupon) and `amountRefunded` what was
 * already given back, so "refund in full what it paid" is the difference, invoice by invoice.
 */
export interface SubscriptionInvoice {
  readonly id: string;
  readonly reason: InvoiceReason;
  readonly status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  /** AR-17: reais. */
  readonly amountPaid: Decimal;
  /** AR-17: reais. */
  readonly amountRefunded: Decimal;
}

/** Refunds what remains of one paid invoice (BR-012-29). */
export interface RefundInvoiceInput {
  invoiceId: string;
  /** Stable per invoice (`refund:<ref>:<invoiceId>`): a retry after a crash refunds once. */
  idempotencyKey: string;
}

/** What a refund did: the amount returned now, in reais. */
export interface RefundResult {
  /** AR-17: reais. Zero only when nothing remained to give back. */
  readonly refunded: Decimal;
}

/** Where a checkout session stands at the provider (BR-012-09, ADR-005). */
export interface ProviderCheckoutSession {
  readonly state: 'open' | 'complete' | 'expired';
  /** The subscription the buyer's payment created, once the session is complete. */
  readonly subscriptionId: string | null;
}

/** SPEC-012 BR-012-11: one line of the billing history. */
export interface ProviderInvoice {
  readonly id: string;
  readonly paidAt: Date | null;
  /** AR-17: reais. What the invoice charged (after discounts). */
  readonly amount: Decimal;
  readonly status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  /** The provider's page for this invoice, if it has one. */
  readonly hostedUrl: string | null;
}

export interface CreateBillingPortalSessionInput {
  customerId: string;
  returnUrl: string;
  /** The portal configuration restricted to the payment method and invoices (BR-012-17). */
  configurationId?: string;
}

/** SPEC-012 BR-012-02: a provider price, in our vocabulary. */
export interface ProviderPrice {
  readonly id: string;
  readonly active: boolean;
  /** AR-17: reais per interval. */
  readonly amount: Decimal;
  readonly interval: 'day' | 'week' | 'month' | 'year' | null;
  /** Intervals per charge: a plan bills every 1 month or year, never every 3. */
  readonly intervalCount: number | null;
  /** A licensed (fixed per-unit) price, not metered usage. */
  readonly licensed: boolean;
  /** One unit price, not tiered or volume. */
  readonly perUnit: boolean;
  /** Lower-case ISO 4217, as the provider names it ('brl'). */
  readonly currency: string;
}

export interface CreateFixedDiscountInput {
  /** The user-facing code, upper-cased. */
  code: string;
  /** AR-17: reais, as a Decimal. The adapter, and only it, turns this into centavos (AR-20). */
  amountOff: Decimal;
  expiresAt: Date;
}

export interface FixedDiscount {
  couponId: string;
  promotionCodeId: string;
}

/** The statuses a provider subscription can be in, as the provider names them. */
export const PROVIDER_SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'paused',
] as const;
export type ProviderSubscriptionStatus = (typeof PROVIDER_SUBSCRIPTION_STATUSES)[number];

/**
 * The provider's current view of one subscription, read by `retrieveSubscription`. It is a
 * snapshot: whatever it says is true as of the call, and nothing else (a later call may differ).
 */
export interface ProviderSubscription {
  readonly id: string;
  readonly status: ProviderSubscriptionStatus;
  readonly customerId: string;
  /** Renewal stopped; the subscription ends when the paid period does (BR-012-19). */
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  /** The price the subscription is billed at now (its only item). */
  readonly priceId: string;
  /** A downgrade scheduled for the next period: its price and when it starts (BR-012-17). */
  readonly scheduledPriceId: string | null;
  readonly scheduledChangeAt: Date | null;
  /**
   * When the invoice that STARTED the subscription (its `subscription_create` invoice) was paid:
   * the provider's confirmation of the first payment (BR-012-29, DL-012-10). Never the latest
   * invoice, which after an upgrade or a renewal is another payment.
   */
  readonly firstInvoicePaidAt: Date | null;
  /** The first invoice was paid and charged nothing (a 100% coupon): no money to give back. */
  readonly firstInvoiceFree: boolean;
  /** Our subscription ref, set on the provider subscription at checkout. */
  readonly subscriptionRef: string | null;
  /** When cancellation was requested (not when it takes effect). */
  readonly canceledAt: Date | null;
  /** When the provider ended it, if it has. */
  readonly endedAt: Date | null;
}

/**
 * A verified webhook event, in our vocabulary rather than the provider's. `id` is the provider's
 * event id, the key of idempotency (SC-11). Only the events the product acts on are modelled; any
 * other arrives as `unhandled` with the provider's type name. No event carries state to trust:
 * the service reads the subscription again (BR-012-13).
 */
export type PaymentEvent = { readonly id: string } & (
  | {
      type: 'checkout.completed';
      subscriptionId: string | null;
      /** Our ref from the checkout session; absent on a legacy user-level checkout. */
      subscriptionRef: string | null;
    }
  /** A subscription was created, updated or deleted (the event type does not matter, BR-012-13). */
  | { type: 'subscription.changed'; subscriptionId: string }
  | { type: 'invoice.paid'; subscriptionId: string | null }
  | { type: 'invoice.payment_failed'; subscriptionId: string | null }
  /** The customer never completed the checkout page: the session id is what names the checkout. */
  | { type: 'checkout.expired'; checkoutSessionId: string }
  | { type: 'unhandled'; providerType: string }
);

/**
 * The signature (or the body it covers) did not verify (SC-11). Only this is an invalid request:
 * any other failure of `parseWebhookEvent` is a fault of ours (a mapping bug), answered 5xx.
 */
export class WebhookSignatureError extends Error {
  constructor() {
    super('The webhook signature did not verify');
    this.name = 'WebhookSignatureError';
  }
}

/** An abstract class rather than an interface so it doubles as the Nest injection token. */
export abstract class PaymentGateway {
  abstract createCustomer(input: CreateCustomerInput): Promise<{ id: string }>;

  /** BR-012-10: the hosted Checkout of a new subscription; card data never touches us. */
  abstract createOfficeCheckout(input: CreateOfficeCheckoutInput): Promise<CheckoutSession>;

  /**
   * Stops accepting payment on a checkout session. 'expired' when it is closed now (or already
   * was), 'completed' when the buyer already paid it, so the session cannot be replaced.
   */
  abstract expireCheckoutSession(sessionId: string): Promise<'expired' | 'completed'>;

  /**
   * BR-012-16: an UPGRADE now. The provider invoices the prorated difference at once and changes
   * the subscription's price only when that invoice is paid (pending update), so the plan and the
   * limit follow the paid price (the sync reads it). Releases nothing: the caller releases a
   * pending schedule first.
   */
  abstract changeSubscriptionPrice(input: ChangePriceInput): Promise<void>;

  /**
   * BR-012-17: a change that starts with the next billing period (a downgrade, or the same limit),
   * as a subscription schedule. Replaces a schedule that already exists.
   */
  abstract scheduleSubscriptionPrice(input: ChangePriceInput): Promise<void>;

  /** BR-012-17: drops a scheduled change; the subscription keeps its current price. Idempotent. */
  abstract releaseScheduledChange(subscriptionId: string, idempotencyKey: string): Promise<void>;

  /** BR-012-19: stop (`cancel: true`) or resume (`false`) renewal at the end of the paid period. */
  abstract setCancelAtPeriodEnd(input: SetCancelAtPeriodEndInput): Promise<void>;

  /**
   * BR-012-29: the invoices of a subscription (every one, newest first) with what each was paid and
   * already refunded. The refund reads THESE, never `latest_invoice`: the first payment is the
   * `subscription_create` invoice, and an upgrade paid inside the window is another invoice.
   */
  abstract listSubscriptionInvoices(subscriptionId: string): Promise<SubscriptionInvoice[]>;

  /**
   * BR-012-29: refunds what remains of one paid invoice (paid minus already refunded), idempotent by
   * key. An error saying the key or the charge was already used counts as done only after the
   * provider's own refunded amount for that invoice is read back and found to cover it; any other
   * failure throws. Zero is returned only when nothing remained.
   */
  abstract refundInvoice(input: RefundInvoiceInput): Promise<RefundResult>;

  /** Voids an unpaid invoice so it can never be paid after a refund and cancel. Idempotent. */
  abstract voidInvoice(invoiceId: string): Promise<void>;

  /** Where a checkout session stands, and the subscription it created if the buyer paid. */
  abstract retrieveCheckoutSession(sessionId: string): Promise<ProviderCheckoutSession>;

  /** The provider customer already made for this account (our user id in its metadata), if any. */
  abstract findCustomerByUserId(userId: string): Promise<string | null>;

  /** BR-012-11: the customer's invoices, newest first. */
  abstract listInvoices(customerId: string, limit: number): Promise<ProviderInvoice[]>;

  /** BR-012-10, BR-012-17: the provider's page to update the payment method and see invoices. */
  abstract createBillingPortalSession(
    input: CreateBillingPortalSessionInput,
  ): Promise<{ url: string }>;

  /** BR-012-02: the provider price, or null when it does not exist. */
  abstract getPrice(priceId: string): Promise<ProviderPrice | null>;

  /**
   * Cancels a subscription at once (a duplicate paid twice, BR-012-08). Idempotent: a
   * subscription the provider already shows as canceled is a success.
   */
  abstract cancelSubscription(subscriptionId: string): Promise<void>;

  /** The provider's current view of a subscription (BR-012-13). Throws when it cannot be read. */
  abstract retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription>;

  /** A one-off fixed discount in BRL and the promotion code customers type for it. */
  abstract createFixedDiscount(input: CreateFixedDiscountInput): Promise<FixedDiscount>;

  abstract deactivatePromotionCode(promotionCodeId: string): Promise<void>;

  /**
   * Verifies the provider's signature over the exact bytes received (SC-11) and maps the event.
   * Throws `WebhookSignatureError` when the signature does not verify; any other error is a fault.
   * An event of the other mode than the configured key (test vs live) comes back `unhandled`.
   */
  abstract parseWebhookEvent(rawBody: Buffer, signature: string): PaymentEvent;
}
