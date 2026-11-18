// SPEC-012 BR-012-29 (D-48, CDC art. 49, pending the lawyer Q-21): the right of withdrawal. Cancelling
// the FIRST subscription of an office within 7 days of the provider's confirmation of its first
// payment refunds it in full and ends it at once. Pure (AR-05): the time is an argument.
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the rule reads of the subscription being cancelled. */
export interface RefundFacts {
  /** The provider's confirmation of the first payment; null while nothing was paid. */
  readonly firstPaidAt: Date | null;
  /** Set once the refund was made: a subscription is refunded once. */
  readonly refundedAt: Date | null;
  /** The office already had a subscription that was paid before this one (not the first-ever). */
  readonly earlierPaidSubscription: boolean;
}

/** The first instant the refund is no longer owed: `firstPaidAt` plus the window. */
export function refundWindowEnd(firstPaidAt: Date, windowDays: number): Date {
  return new Date(firstPaidAt.getTime() + windowDays * DAY_MS);
}

/**
 * Until when cancelling refunds in full, or null when it does not (any more). The window is the
 * half-open interval [firstPaidAt, firstPaidAt + windowDays): at exactly 7 days it is closed.
 *
 *   first paid 2026-03-01T12:00Z, 7 days: day 6 (03-07T12:00Z) → 2026-03-08T12:00Z;
 *   03-08T12:00Z exactly and day 8 → null.
 *   an earlier paid subscription of the office, or a refund already made → null.
 */
export function refundEligibleUntil(
  facts: RefundFacts,
  now: Date,
  windowDays: number,
): Date | null {
  if (facts.firstPaidAt === null) return null;
  if (facts.refundedAt !== null) return null;
  if (facts.earlierPaidSubscription) return null;
  const end = refundWindowEnd(facts.firstPaidAt, windowDays);
  return now.getTime() < end.getTime() ? end : null;
}
