import type { Plan } from '../../src/plans/plan.js';
import type { CatalogUpsertOutcome, PlansService } from '../../src/plans/plans.service.js';

type Port<T> = { [K in keyof T]: T[K] };

/**
 * TS-03: a hand-written fake of the plan catalog service. It implements the real public surface
 * (a mapped type drops the private repository), so a signature change breaks it at compile time.
 */
export class InMemoryPlans implements Port<PlansService> {
  constructor(public plans: Plan[] = []) {}

  listOffered(): Promise<Plan[]> {
    return Promise.resolve(
      this.plans
        .filter((plan) => plan.status === 'OFFERED')
        .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)),
    );
  }

  findByCode(code: string): Promise<Plan | null> {
    return Promise.resolve(this.plans.find((plan) => plan.code === code) ?? null);
  }

  findById(id: string): Promise<Plan | null> {
    return Promise.resolve(this.plans.find((plan) => plan.id === id) ?? null);
  }

  findByStripePriceId(stripePriceId: string): Promise<Plan | null> {
    return Promise.resolve(this.plans.find((plan) => plan.stripePriceId === stripePriceId) ?? null);
  }

  upsertCatalog(): Promise<CatalogUpsertOutcome> {
    return Promise.reject(new Error('not needed by the specs that use this fake'));
  }
}
