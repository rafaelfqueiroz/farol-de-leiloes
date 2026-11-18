// SPEC-012 BR-012-01..BR-012-05: the plan catalog. Other modules reach plans only through this
// service (AR-09).
import { Injectable } from '@nestjs/common';
import { PaymentGateway } from '../payments/payment-gateway.js';
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
  | { result: 'refused_price_changed'; conflicts: number }
  /**
   * The provider price does not exist, is archived (for an offered plan), or differs from the
   * catalog's amount, interval or currency (BRL): nothing was written. A customer would be charged
   * something other than the plans page shows.
   */
  | { result: 'refused_price_mismatch'; conflicts: number };

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
  constructor(
    private readonly plans: PlansRepository,
    // AR-10: the provider's price is checked through the port before anything is written.
    private readonly gateway: PaymentGateway,
  ) {}

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
   * run changes nothing, and what passes is written as one command (`upsertMany`); a plan edit
   * never touches a subscription's copied limit (BR-012-04).
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

    // The price the plans page shows is the price the provider charges: checked at the provider
    // (amount in reais, interval, currency; an offered plan's price must still be active).
    const mismatches = (
      await Promise.all(existing.map(({ definition }) => this.priceMatches(definition)))
    ).filter((matches) => !matches);
    if (mismatches.length > 0) {
      return { result: 'refused_price_mismatch', conflicts: mismatches.length };
    }

    const changed = existing.filter(
      ({ definition, byCode }) => byCode === null || !sameDefinition(byCode, definition),
    );
    const { created } = await this.plans.upsertMany(changed.map(({ definition }) => definition));
    return {
      result: 'applied',
      created,
      updated: changed.length - created,
      unchanged: existing.length - changed.length,
    };
  }

  private async priceMatches(definition: PlanDefinition): Promise<boolean> {
    const price = await this.gateway.getPrice(definition.stripePriceId);
    if (price === null) return false;
    // A withdrawn plan's price may be archived at the provider; subscribers keep paying it.
    if (definition.status === 'OFFERED' && !price.active) return false;
    return (
      price.amount.equals(definition.price) &&
      price.interval === definition.interval &&
      price.currency === 'brl'
    );
  }
}
