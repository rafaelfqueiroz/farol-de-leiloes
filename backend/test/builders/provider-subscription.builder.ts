import type { ProviderSubscription } from '../../src/payments/payment-gateway.js';

/** TS-29: a provider subscription that is active and mid-period, overridden per test. */
export function aProviderSubscription(
  overrides: Partial<ProviderSubscription> = {},
): ProviderSubscription {
  return {
    id: 'sub_test_1',
    status: 'active',
    customerId: 'cus_test_1',
    cancelAtPeriodEnd: false,
    currentPeriodStart: new Date('2026-01-10T12:00:00.000Z'),
    currentPeriodEnd: new Date('2026-02-10T12:00:00.000Z'),
    priceId: 'price_test_plan_5',
    scheduledPriceId: null,
    scheduledChangeAt: null,
    firstInvoicePaidAt: new Date('2026-01-10T12:00:05.000Z'),
    firstInvoiceFree: false,
    subscriptionRef: null,
    canceledAt: null,
    endedAt: null,
    ...overrides,
  };
}
