import type { Plan, PlanDefinition } from '../../src/plans/plan.js';
import type { PlansRepository } from '../../src/plans/plans.repository.js';

type Port<T> = { [K in keyof T]: T[K] };

/**
 * TS-03: an in-memory fake of the plan repository. The MongoDB behaviour itself (the unique
 * indexes, the upsert, Decimal128 round trip) is proven in test/integration/plans.spec.ts (TS-02).
 */
export class FakePlansRepository implements Port<PlansRepository> {
  readonly rows: Plan[] = [];
  /** Every upsert, so a spec can see that a refused or unchanged run wrote nothing. */
  readonly upserts: PlanDefinition[] = [];
  private sequence = 0;

  async findOffered(): Promise<Plan[]> {
    return this.rows
      .filter((plan) => plan.status === 'OFFERED')
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  }

  async findByCode(code: string): Promise<Plan | null> {
    return this.rows.find((plan) => plan.code === code) ?? null;
  }

  async findById(id: string): Promise<Plan | null> {
    return this.rows.find((plan) => plan.id === id) ?? null;
  }

  async findByStripePriceId(stripePriceId: string): Promise<Plan | null> {
    return this.rows.find((plan) => plan.stripePriceId === stripePriceId) ?? null;
  }

  async upsertByCode(definition: PlanDefinition): Promise<'created' | 'updated'> {
    this.upserts.push(definition);
    const index = this.rows.findIndex((plan) => plan.code === definition.code);
    if (index >= 0) {
      const existing = this.rows[index] as Plan;
      this.rows[index] = { ...existing, ...definition };
      return 'updated';
    }
    this.sequence += 1;
    this.rows.push({
      ...definition,
      id: `64b7f0000000000000ee${String(this.sequence).padStart(4, '0')}`,
      audience: 'ADVISOR_OFFICE',
    });
    return 'created';
  }
}
