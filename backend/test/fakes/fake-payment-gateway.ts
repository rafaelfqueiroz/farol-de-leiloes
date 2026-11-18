import {
  type CreateCustomerInput,
  type CreateFixedDiscountInput,
  type FixedDiscount,
  PaymentGateway,
  type PaymentEvent,
  type ProviderSubscription,
} from '../../src/payments/payment-gateway.js';

/**
 * TS-03 / TS-07: a hand-written fake of the PaymentGateway port. It records what services asked
 * for, in the port's own vocabulary (reais as Decimal, never centavos: that conversion is the
 * Stripe adapter's, AR-20), and answers predictable ids. Nothing reaches Stripe.
 *
 *   const gateway = new FakePaymentGateway();
 *   gateway.nextWebhookEvent = { id: 'evt_1', type: 'subscription.changed', subscriptionId: 'sub_1' };
 *   gateway.setSubscription(aProviderSubscription({ id: 'sub_1', status: 'active' }));
 */
export class FakePaymentGateway extends PaymentGateway {
  readonly customers: CreateCustomerInput[] = [];
  readonly cancelledSubscriptions: string[] = [];
  readonly discounts: CreateFixedDiscountInput[] = [];
  readonly deactivatedPromotionCodes: string[] = [];
  /** Every retrieveSubscription call, in order (BR-012-13: a sync always re-reads the provider). */
  readonly retrievals: string[] = [];

  /** What parseWebhookEvent answers; an Error makes it throw, as a bad signature does. */
  nextWebhookEvent: PaymentEvent | Error = {
    id: 'evt_test',
    type: 'unhandled',
    providerType: 'test.event',
  };
  /** Makes deactivatePromotionCode fail, as an unreachable provider would. */
  failDeactivation = false;
  /**
   * Runs at the start of every retrieveSubscription, before it answers: a spec uses it to change
   * the provider's state while a sync is in flight, to hold a retrieve open (concurrency), or to
   * make it fail.
   */
  onRetrieve: ((subscriptionId: string) => Promise<void> | void) | undefined;

  private readonly subscriptions = new Map<string, ProviderSubscription>();

  /** The provider's current state of a subscription; replaces what was there. */
  setSubscription(subscription: ProviderSubscription): void {
    this.subscriptions.set(subscription.id, subscription);
  }

  async createCustomer(input: CreateCustomerInput): Promise<{ id: string }> {
    this.customers.push(input);
    return { id: `cus_fake_${this.customers.length}` };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    this.cancelledSubscriptions.push(subscriptionId);
    const current = this.subscriptions.get(subscriptionId);
    if (current) {
      this.subscriptions.set(subscriptionId, { ...current, status: 'canceled' });
    }
  }

  async retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    this.retrievals.push(subscriptionId);
    await this.onRetrieve?.(subscriptionId);
    const current = this.subscriptions.get(subscriptionId);
    if (!current) throw new Error('resource_missing');
    return current;
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
