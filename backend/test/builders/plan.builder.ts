import { Decimal } from '../../src/common/money/money.js';
import type { Plan } from '../../src/plans/plan.js';

/** TS-29: an offered monthly plan with a limit of 5, overridden per test. */
export function aPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: '64b7f0000000000000000a05',
    code: 'escritorio-5',
    name: 'Escritório 5',
    audience: 'ADVISOR_OFFICE',
    price: new Decimal('199.90'),
    interval: 'month',
    activeJourneyLimit: 5,
    stripePriceId: 'price_test_plan_5',
    status: 'OFFERED',
    sortOrder: 10,
    ...overrides,
  };
}
