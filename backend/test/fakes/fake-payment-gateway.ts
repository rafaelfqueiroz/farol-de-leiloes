import { Decimal } from '../../src/common/money/money.js';
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
  type ProviderInvoice,
  type ProviderPrice,
  type ProviderSubscription,
  type RefundLatestPaymentInput,
  type RefundResult,
  type SetCancelAtPeriodEndInput,
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

  /**
   * What parseWebhookEvent answers; an Error makes it throw (`new WebhookSignatureError()` is a
   * bad signature, any other Error a fault of the mapping).
   */
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
  /**
   * Runs after the snapshot was taken and before it is returned: a spec uses it to hold a read
   * whose answer is already STALE (the provider changes while the reader waits), which is what a
   * slow network does to a retrieve.
   */
  afterRetrieve: ((subscriptionId: string) => Promise<void> | void) | undefined;

  /** SPEC-012 billing: every checkout asked for, in order (BR-012-10). */
  readonly checkouts: CreateOfficeCheckoutInput[] = [];
  /** The sessions closed by `expireCheckoutSession`. */
  readonly expiredSessions: string[] = [];
  /** Sessions the buyer already paid: they cannot be expired (`expireCheckoutSession`). */
  readonly completedSessions = new Set<string>();
  /** Every immediate price change asked for (BR-012-16), in order. */
  readonly priceChanges: ChangePriceInput[] = [];
  /** Every scheduled price change asked for (BR-012-17), in order. */
  readonly scheduledChanges: ChangePriceInput[] = [];
  /** The subscriptions whose scheduled change was released, in order. */
  readonly releasedSchedules: string[] = [];
  readonly cancelAtPeriodEndChanges: SetCancelAtPeriodEndInput[] = [];
  /** Refunds actually made (a repeated idempotency key is made once), BR-012-29. */
  readonly refunds: Array<RefundLatestPaymentInput & { refunded: Decimal }> = [];
  /** Every refund REQUEST, repeats included: proves the call happened, not the money moved. */
  readonly refundRequests: string[] = [];
  readonly portalSessions: CreateBillingPortalSessionInput[] = [];
  /** What each subscription's latest invoice charged, in reais (BR-012-29). */
  readonly paidAmounts = new Map<string, Decimal>();
  /** The invoices `listInvoices` answers (BR-012-11), newest first. */
  invoices: ProviderInvoice[] = [];
  /** Invoices of one customer; a customer without an entry gets `invoices`. */
  readonly invoicesByCustomer = new Map<string, ProviderInvoice[]>();
  /** The provider's prices by id (BR-012-02); an absent one does not exist. */
  readonly prices = new Map<string, ProviderPrice>();
  /**
   * The provider has a price exactly like this plan's (BR-012-02): what the catalog script finds
   * when it checks a definition. `overrides` makes it diverge.
   */
  listsPlan(
    plan: { stripePriceId: string; price: Decimal; interval: 'month' | 'year' },
    overrides: Partial<ProviderPrice> = {},
  ): void {
    this.prices.set(plan.stripePriceId, {
      id: plan.stripePriceId,
      active: true,
      amount: plan.price,
      interval: plan.interval,
      currency: 'brl',
      ...overrides,
    });
  }

  /** Makes the next createOfficeCheckout / createBillingPortalSession / listInvoices fail. */
  failCheckout = false;
  failPortal = false;
  failInvoices = false;
  /** An upgrade is applied at once (a paid proration) instead of pending until `payPendingChange`. */
  payUpgradesAtOnce = false;
  /** Runs at the start of every refund request, before it is recorded (concurrency specs). */
  onRefund: ((subscriptionId: string) => Promise<void> | void) | undefined;

  private readonly pendingPriceChanges = new Map<string, string>();
  private readonly refundKeys = new Map<string, Decimal>();
  private readonly subscriptions = new Map<string, ProviderSubscription>();

  /** The provider's current state of a subscription; replaces what was there. */
  setSubscription(subscription: ProviderSubscription): void {
    this.subscriptions.set(subscription.id, subscription);
  }

  async createCustomer(input: CreateCustomerInput): Promise<{ id: string }> {
    this.customers.push(input);
    return { id: `cus_fake_${this.customers.length}` };
  }

  async createOfficeCheckout(input: CreateOfficeCheckoutInput): Promise<CheckoutSession> {
    if (this.failCheckout) throw new Error('provider unreachable');
    this.checkouts.push(input);
    const sessionId = `cs_fake_${this.checkouts.length}`;
    return { sessionId, url: `https://checkout.example.test/${sessionId}` };
  }

  async expireCheckoutSession(sessionId: string): Promise<'expired' | 'completed'> {
    if (this.completedSessions.has(sessionId)) return 'completed';
    this.expiredSessions.push(sessionId);
    return 'expired';
  }

  /** The provider's subscription as it is now (a spec reads what the port changed). */
  current(subscriptionId: string): ProviderSubscription {
    const current = this.subscriptions.get(subscriptionId);
    if (!current) throw new Error('resource_missing');
    return current;
  }

  async changeSubscriptionPrice(input: ChangePriceInput): Promise<void> {
    this.priceChanges.push(input);
    // BR-012-16: pending until the prorated invoice is paid, unless the spec pays at once.
    if (this.payUpgradesAtOnce) this.apply(input.subscriptionId, { priceId: input.priceId });
    else this.pendingPriceChanges.set(input.subscriptionId, input.priceId);
  }

  /** The prorated invoice of a pending upgrade was paid: the provider bills the new price. */
  payPendingChange(subscriptionId: string): void {
    const priceId = this.pendingPriceChanges.get(subscriptionId);
    if (priceId === undefined) throw new Error('no pending change');
    this.pendingPriceChanges.delete(subscriptionId);
    this.apply(subscriptionId, { priceId });
  }

  async scheduleSubscriptionPrice(input: ChangePriceInput): Promise<void> {
    this.scheduledChanges.push(input);
    const current = this.current(input.subscriptionId);
    this.apply(input.subscriptionId, {
      scheduledPriceId: input.priceId,
      scheduledChangeAt: current.currentPeriodEnd,
    });
  }

  async releaseScheduledChange(subscriptionId: string): Promise<void> {
    this.releasedSchedules.push(subscriptionId);
    this.apply(subscriptionId, { scheduledPriceId: null, scheduledChangeAt: null });
  }

  async setCancelAtPeriodEnd(input: SetCancelAtPeriodEndInput): Promise<void> {
    this.cancelAtPeriodEndChanges.push(input);
    this.apply(input.subscriptionId, { cancelAtPeriodEnd: input.cancel });
  }

  async refundLatestPayment(input: RefundLatestPaymentInput): Promise<RefundResult> {
    await this.onRefund?.(input.subscriptionId);
    this.refundRequests.push(input.idempotencyKey);
    // The provider deduplicates by key: a repeat answers the first refund, moving no money again.
    const earlier = this.refundKeys.get(input.idempotencyKey);
    if (earlier !== undefined) return { refunded: earlier };
    const refunded = this.paidAmounts.get(input.subscriptionId) ?? new Decimal('199.90');
    this.refundKeys.set(input.idempotencyKey, refunded);
    if (refunded.greaterThan(0)) this.refunds.push({ ...input, refunded });
    return { refunded };
  }

  async listInvoices(customerId: string): Promise<ProviderInvoice[]> {
    if (this.failInvoices) throw new Error('provider unreachable');
    return this.invoicesByCustomer.get(customerId) ?? this.invoices;
  }

  async createBillingPortalSession(
    input: CreateBillingPortalSessionInput,
  ): Promise<{ url: string }> {
    if (this.failPortal) throw new Error('provider unreachable');
    this.portalSessions.push(input);
    return { url: `https://billing.example.test/session_${this.portalSessions.length}` };
  }

  async getPrice(priceId: string): Promise<ProviderPrice | null> {
    return this.prices.get(priceId) ?? null;
  }

  private apply(subscriptionId: string, changes: Partial<ProviderSubscription>): void {
    this.subscriptions.set(subscriptionId, { ...this.current(subscriptionId), ...changes });
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
    await this.afterRetrieve?.(subscriptionId);
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
