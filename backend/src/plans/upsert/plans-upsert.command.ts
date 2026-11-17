import { Injectable } from '@nestjs/common';
import type { PlanDefinition } from '../plan.js';
import { type CatalogUpsertOutcome, PlansService } from '../plans.service.js';

/** The operator script's one action: write a validated catalog (BR-012-02). */
@Injectable()
export class PlansUpsertCommand {
  constructor(private readonly plans: PlansService) {}

  run(definitions: readonly PlanDefinition[]): Promise<CatalogUpsertOutcome> {
    return this.plans.upsertCatalog(definitions);
  }
}

/** Exit code of the script: 0 when the catalog was written (or already was), 1 when refused. */
export function exitCodeOf(outcome: CatalogUpsertOutcome): 0 | 1 {
  return outcome.result === 'applied' ? 0 : 1;
}

/** The one line the script prints: counts only (SC-15), never a plan's content. */
export function summaryOf(outcome: CatalogUpsertOutcome): string {
  if (outcome.result === 'applied') {
    return `plans:upsert: created ${outcome.created}, updated ${outcome.updated}, unchanged ${outcome.unchanged}`;
  }
  return `plans:upsert: ${outcome.result} (${outcome.conflicts}); nothing was written`;
}
