import {
  type CreateCustomerInput,
  type CreateFixedDiscountInput,
  type CreateSubscriptionCheckoutInput,
  type FixedDiscount,
  PaymentGateway,
  type PaymentEvent,
} from '../../src/payments/payment-gateway.js';

/**
 * TS-03 / TS-07: a hand-written fake of the PaymentGateway port. It records what services asked
 * for, in the port's own vocabulary (reais as Decimal, never centavos: that conversion is the
 * Stripe adapter's, AR-20), and answers predictable ids. Nothing reaches Stripe.
 *
 *   const gateway = new FakePaymentGateway();
 *   gateway.nextWebhookEvent = { type: 'subscription.deleted', customerId: 'cus_1' };
 */
export class FakePaymentGateway extends PaymentGateway {
  readonly customers: CreateCustomerInput[] = [];
  readonly checkouts: CreateSubscriptionCheckoutInput[] = [];
  readonly cancelledSubscriptions: string[] = [];
  readonly discounts: CreateFixedDiscountInput[] = [];
  readonly deactivatedPromotionCodes: string[] = [];

  /** The URL createSubscriptionCheckout answers; null to simulate a session without one. */
  checkoutUrl: string | null = 'https://checkout.example.test/session';
  /** What parseWebhookEvent answers; an Error makes it throw, as a bad signature does. */
  nextWebhookEvent: PaymentEvent | Error = { type: 'unhandled', providerType: 'test.event' };
  /** Makes deactivatePromotionCode fail, as an unreachable provider would. */
  failDeactivation = false;

  async createCustomer(input: CreateCustomerInput): Promise<{ id: string }> {
    this.customers.push(input);
    return { id: `cus_fake_${this.customers.length}` };
  }

  async createSubscriptionCheckout(
    input: CreateSubscriptionCheckoutInput,
  ): Promise<{ url: string | null }> {
    this.checkouts.push(input);
    return { url: this.checkoutUrl };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    this.cancelledSubscriptions.push(subscriptionId);
  }

  async createFixedDiscount(input: CreateFixedDiscountInput): Promise<FixedDiscount> {
    this.discounts.push(input);
    const n = this.discounts.length;
    return { couponId: `coupon_fake_${n}`, promotionCodeId: `promo_fake_${n}` };
  }

  async deactivatePromotionCode(promotionCodeId: string): Promise<void> {
    if (this.failDeactivation) throw new Error('provider unreachable');
    this.deactivatedPromotionCodes.push(promotionCodeId);
  }

  parseWebhookEvent(): PaymentEvent {
    if (this.nextWebhookEvent instanceof Error) throw this.nextWebhookEvent;
    return this.nextWebhookEvent;
  }

  /** The amounts asked for, in reais, as strings — handy for assertions. */
  discountAmounts(): string[] {
    return this.discounts.map((discount) => discount.amountOff.toFixed());
  }
}
