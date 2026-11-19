// SPEC-012 BR-012-01..BR-012-05: the plan catalog. Other modules reach plans only through this
// service (AR-09).
import { Injectable } from '@nestjs/common';
import type { Plan, PlanDefinition } from './plan.js';
import { PlansRepository } from './plans.repository.js';

/** What `npm run plans:upsert` did, as counts only (SC-15). */
export type CatalogUpsertOutcome =
  | { result: 'applied'; created: number; updated: number; unchanged: number }
  /** A provider price is already another plan's: nothing was written. */
  | { result: 'refused_duplicate_price'; conflicts: number }
  /**
   * The code already exists with another provider price: nothing was written. A plan's price id
   * never changes (subscriptions on it keep paying it, BR-012-04); a new price is a new code.
   */
  | { result: 'refused_price_changed'; conflicts: number };

function sameDefinition(plan: Plan, definition: PlanDefinition): boolean {
  return (
    plan.name === definition.name &&
    plan.price.equals(definition.price) &&
    plan.interval === definition.interval &&
    plan.activeJourneyLimit === definition.activeJourneyLimit &&
    plan.stripePriceId === definition.stripePriceId &&
    plan.status === definition.status &&
    plan.sortOrder === definition.sortOrder
  );
}

@Injectable()
export class PlansService {
  constructor(private readonly plans: PlansRepository) {}

  /** BR-012-05: every offered plan, in the operator's order. */
  listOffered(): Promise<Plan[]> {
    return this.plans.findOffered();
  }

  findByCode(code: string): Promise<Plan | null> {
    return this.plans.findByCode(code);
  }

  findById(id: string): Promise<Plan | null> {
    return this.plans.findById(id);
  }

  /** BR-012-04: a withdrawn plan resolves too, so the sync keeps a subscription on it. */
  findByStripePriceId(stripePriceId: string): Promise<Plan | null> {
    return this.plans.findByStripePriceId(stripePriceId);
  }

  /**
   * BR-012-02: the catalog script. Everything is checked before anything is written, so a refused
   * run changes nothing; a plan edit never touches a subscription's copied limit (BR-012-04).
   */
  async upsertCatalog(definitions: readonly PlanDefinition[]): Promise<CatalogUpsertOutcome> {
    const existing = await Promise.all(
      definitions.map(async (definition) => ({
        definition,
        byCode: await this.plans.findByCode(definition.code),
        byPrice: await this.plans.findByStripePriceId(definition.stripePriceId),
      })),
    );

    // A provider price belongs to one plan (unique index too), whichever the file or the database.
    const duplicates = existing.filter(
      ({ definition, byPrice }) => byPrice !== null && byPrice.code !== definition.code,
    );
    if (duplicates.length > 0) {
      return { result: 'refused_duplicate_price', conflicts: duplicates.length };
    }
    const changedPrice = existing.filter(
      ({ definition, byCode }) =>
        byCode !== null && byCode.stripePriceId !== definition.stripePriceId,
    );
    if (changedPrice.length > 0) {
      return { result: 'refused_price_changed', conflicts: changedPrice.length };
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const { definition, byCode } of existing) {
      if (byCode !== null && sameDefinition(byCode, definition)) {
        unchanged += 1;
        continue;
      }
      if ((await this.plans.upsertByCode(definition)) === 'created') created += 1;
      else updated += 1;
    }
    return { result: 'applied', created, updated, unchanged };
  }
}
