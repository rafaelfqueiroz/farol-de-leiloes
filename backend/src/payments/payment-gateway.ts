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
import type { Decimal } from '../common/money/money.js';

export interface CreateCustomerInput {
  email: string;
  name: string;
  /** Our user id, kept on the provider's customer so its events can be traced back. */
  userId: string;
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
  /** When the latest invoice was paid, if it was: the provider's confirmation of payment. */
  readonly latestInvoicePaidAt: Date | null;
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
  /** The customer never completed the checkout page. */
  | { type: 'checkout.expired'; subscriptionRef: string | null }
  | { type: 'unhandled'; providerType: string }
);

/** An abstract class rather than an interface so it doubles as the Nest injection token. */
export abstract class PaymentGateway {
  abstract createCustomer(input: CreateCustomerInput): Promise<{ id: string }>;

  /** Cancels a subscription at once (a duplicate paid twice, BR-012-08). */
  abstract cancelSubscription(subscriptionId: string): Promise<void>;

  /** The provider's current view of a subscription (BR-012-13). Throws when it cannot be read. */
  abstract retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription>;

  /** A one-off fixed discount in BRL and the promotion code customers type for it. */
  abstract createFixedDiscount(input: CreateFixedDiscountInput): Promise<FixedDiscount>;

  abstract deactivatePromotionCode(promotionCodeId: string): Promise<void>;

  /**
   * Verifies the provider's signature over the exact bytes received (SC-11) and maps the event.
   * Throws when the signature does not verify.
   */
  abstract parseWebhookEvent(rawBody: Buffer, signature: string): PaymentEvent;
}
