// SPEC-012 BR-012-16..BR-012-18: what choosing another plan does to a subscription in effect.
// Pure (AR-05). The limit is compared on the subscription's own copy (BR-012-04), never on the
// catalog's current number for the plan it is on.

export type PlanChange =
  /** Nothing to do: the plan is the one in effect, or the one already scheduled. */
  | 'keep'
  /** The plan chosen is the one in effect while a downgrade is scheduled: drop the schedule. */
  | 'release_schedule'
  /** BR-012-16: a higher limit, now, with the prorated difference. */
  | 'upgrade'
  /** BR-012-17: an equal or lower limit, from the next billing period. */
  | 'schedule';

export interface CurrentPlanFacts {
  readonly planId: string;
  readonly activeJourneyLimit: number;
  readonly scheduledPlanId: string | null;
}

export interface TargetPlanFacts {
  readonly id: string;
  readonly activeJourneyLimit: number;
}

/**
 * Example: on a limit-2 plan, choosing a limit-5 plan is an upgrade; on a limit-5 plan, choosing a
 * limit-2 or another limit-5 plan is scheduled for the period end, whatever the journeys in
 * progress (BR-012-18: a downgrade below the count is allowed); choosing the plan in effect while a
 * downgrade is scheduled releases that schedule.
 */
export function classifyPlanChange(current: CurrentPlanFacts, target: TargetPlanFacts): PlanChange {
  if (target.id === current.planId) {
    return current.scheduledPlanId === null ? 'keep' : 'release_schedule';
  }
  if (target.id === current.scheduledPlanId) return 'keep';
  return target.activeJourneyLimit > current.activeJourneyLimit ? 'upgrade' : 'schedule';
}
