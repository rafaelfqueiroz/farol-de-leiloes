// SPEC-012 BR-012-08: which of two subscriptions of one office, both in effect at the provider, is
// the later one and so the one that is cancelled. Pure (AR-05).

/** What the comparison reads of a subscription. */
export interface DuplicateCandidate {
  /** The subscription ref: a MongoDB ObjectId in hex, which begins with its creation time. */
  readonly id: string;
  /** The provider-confirmed first payment, if there is one. */
  readonly firstPaidAt: Date | null;
}

/**
 * True when `a` is the later subscription. By first payment when both have one, otherwise (or on
 * a tie) by creation, read from the id: the earlier, paid subscription is the one that stays, so
 * a late reactivation never takes the office from the subscription that has been paid longest.
 *
 *   a paid 2026-01-10, b paid 2026-02-01   → b is later
 *   a paid 2026-01-10, b never confirmed   → ids decide
 */
export function isLaterSubscription(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  if (a.firstPaidAt !== null && b.firstPaidAt !== null) {
    const difference = a.firstPaidAt.getTime() - b.firstPaidAt.getTime();
    if (difference !== 0) return difference > 0;
  }
  return a.id > b.id;
}
