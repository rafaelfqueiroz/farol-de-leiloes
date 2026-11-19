import { Decimal } from '../../src/common/money/money.js';
import type { ProviderPrice } from '../../src/payments/payment-gateway.js';

/** TS-29: an active, monthly, licensed per-unit BRL price, overridden per test (BR-012-02). */
export function aProviderPrice(overrides: Partial<ProviderPrice> = {}): ProviderPrice {
  return {
    id: 'price_test_plan_5',
    active: true,
    amount: new Decimal('199.90'),
    interval: 'month',
    intervalCount: 1,
    licensed: true,
    perUnit: true,
    currency: 'brl',
    ...overrides,
  };
}
