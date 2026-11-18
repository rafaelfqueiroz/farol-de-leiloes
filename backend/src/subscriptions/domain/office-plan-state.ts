// SPEC-012 BR-012-21, BR-012-28: what an office's subscriptions say about its plan right now, in
// the terms SPEC-002 reads (OFFICE_PLAN_SOURCE). Pure: the time is an argument (AR-05).
import { isReadOnly } from './grace.js';
import { isInEffect, type SubscriptionStatus } from './subscription-status.js';

/** The entitlement an advisor plan gives (BR-002-13). */
export const ADVISOR_ENTITLEMENT = 'advisor';

/** What the derivation reads of one stored subscription. */
export interface SubscriptionFacts {
  readonly status: SubscriptionStatus;
  readonly lapsedAt: Date | null;
  /** Set once the provider confirmed a payment: a lapse that was never paid is no history. */
  readonly firstPaidAt: Date | null;
}

/** The shape SPEC-002's `OfficePlanState` has (access/sources/office-plan.source.ts). */
export interface OfficePlanFacts {
  readonly advisorPlanActive: boolean;
  readonly readOnly: boolean;
  readonly entitlements: readonly string[];
}

function lapsedTime(subscription: SubscriptionFacts): number {
  return subscription.lapsedAt === null ? 0 : subscription.lapsedAt.getTime();
}

/**
 * The plan state of one office from its subscriptions, or null when it has no confirmed one (the
 * office is then unknown to SPEC-002, which fails closed: no plan, no entitlement, read-only).
 *
 *   in effect (ACTIVE | PAST_DUE | CANCELING)   → advisor, writable; it beats any lapsed one, so a
 *                                                  new payment lifts read-only at once (BR-012-28)
 *   else the latest LAPSED that was paid        → advisor persona and read access survive the
 *                                                  lapse (BR-012-21, BR-012-28); read-only once the
 *                                                  grace period is over (a lapse without its
 *                                                  instant is read-only: fail closed)
 *   anything else (PENDING, never-paid lapse)   → null
 *
 * Example, 10 days of grace, lapsed 2026-03-01T12:00Z: at 2026-03-10T12:00Z (day 9) writable; at
 * 2026-03-11T12:00Z (day 10, the boundary) and at 2026-03-12T12:00Z (day 11) read-only.
 */
export function deriveOfficePlanState(
  subscriptions: readonly SubscriptionFacts[],
  now: Date,
  graceDays: number,
): OfficePlanFacts | null {
  if (subscriptions.some((subscription) => isInEffect(subscription.status))) {
    return { advisorPlanActive: true, readOnly: false, entitlements: [ADVISOR_ENTITLEMENT] };
  }
  const lapsed = subscriptions
    .filter((subscription) => subscription.status === 'LAPSED' && subscription.firstPaidAt !== null)
    .sort((a, b) => lapsedTime(b) - lapsedTime(a))[0];
  if (!lapsed) return null;
  return {
    advisorPlanActive: true,
    readOnly: lapsed.lapsedAt === null || isReadOnly(lapsed.lapsedAt, now, graceDays),
    entitlements: [ADVISOR_ENTITLEMENT],
  };
}
