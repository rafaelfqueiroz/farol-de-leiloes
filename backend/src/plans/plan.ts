// SPEC-012 BR-012-01: a plan as the rest of the backend sees it (detached from the document, money
// as a Decimal, AR-17). Only PlansService hands these out; the schema and repository stay inside
// plans/ (AR-09).
import type { Decimal } from '../common/money/money.js';

export const PLAN_AUDIENCES = ['ADVISOR_OFFICE'] as const;
export type PlanAudience = (typeof PLAN_AUDIENCES)[number];

export const PLAN_INTERVALS = ['month', 'year'] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

/** BR-012-04: a WITHDRAWN plan is not offered to new subscribers; those on it keep it. */
export const PLAN_STATUSES = ['OFFERED', 'WITHDRAWN'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface Plan {
  readonly id: string;
  /** Operator-chosen, unique, stable: what checkout and the catalog script refer to. */
  readonly code: string;
  readonly name: string;
  readonly audience: PlanAudience;
  /** AR-17: reais per interval. The provider charges the price named by `stripePriceId`. */
  readonly price: Decimal;
  readonly interval: PlanInterval;
  /** BR-012-01: the active-journey limit, a positive integer. */
  readonly activeJourneyLimit: number;
  readonly stripePriceId: string;
  readonly status: PlanStatus;
  readonly sortOrder: number;
}

/** What the catalog script writes for one plan (the audience is fixed, BR-012-06). */
export type PlanDefinition = Omit<Plan, 'id' | 'audience'>;
