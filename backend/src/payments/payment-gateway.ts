// AR-10: the payment provider behind a port named for its role. Services (PaymentsService,
// CouponsService) depend on this class only; StripePaymentGateway is the one adapter, the only
// file that imports `stripe` (a structural test holds it to that) and the only place money
// becomes integer centavos (AR-20). Tests use FakePaymentGateway (TS-03).
import type { Decimal } from '../common/money/money.js';

export interface CreateCustomerInput {
  email: string;
  name: string;
  /** Our user id, kept on the provider's customer so its events can be traced back. */
  userId: string;
}

export interface CreateSubscriptionCheckoutInput {
  customerId: string;
  priceId: string;
  /** Where the provider sends the browser afterwards. */
  successUrl: string;
  cancelUrl: string;
  userId: string;
  /** A promotion code to apply, already validated by CouponsService. */
  promotionCodeId?: string;
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

/**
 * A verified webhook event, in our vocabulary rather than the provider's. Only the events the
 * product acts on are modelled; any other arrives as `unhandled` with the provider's type name.
 */
export type PaymentEvent =
  | { type: 'checkout.completed'; userId: string | null; subscriptionId: string | null }
  | { type: 'subscription.updated'; customerId: string | null; status: string }
  | { type: 'subscription.deleted'; customerId: string | null }
  | { type: 'invoice.payment_failed'; customerId: string | null }
  | { type: 'unhandled'; providerType: string };

/** An abstract class rather than an interface so it doubles as the Nest injection token. */
export abstract class PaymentGateway {
  abstract createCustomer(input: CreateCustomerInput): Promise<{ id: string }>;

  /** The hosted checkout page's URL, or null when the provider answers none. */
  abstract createSubscriptionCheckout(
    input: CreateSubscriptionCheckoutInput,
  ): Promise<{ url: string | null }>;

  abstract cancelSubscription(subscriptionId: string): Promise<void>;

  /** A one-off fixed discount in BRL and the promotion code customers type for it. */
  abstract createFixedDiscount(input: CreateFixedDiscountInput): Promise<FixedDiscount>;

  abstract deactivatePromotionCode(promotionCodeId: string): Promise<void>;

  /**
   * Verifies the provider's signature over the exact bytes received (SC-11) and maps the event.
   * Throws when the signature does not verify.
   */
  abstract parseWebhookEvent(rawBody: Buffer, signature: string): PaymentEvent;
}
