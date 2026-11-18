// SPEC-012 BR-012-11, BR-012-26: which of an office's subscriptions its plan page shows. Pure.
import { isInEffect, type SubscriptionStatus } from './subscription-status.js';

export interface DisplayCandidate {
  readonly status: SubscriptionStatus;
  readonly firstPaidAt: Date | null;
  readonly createdAt: Date;
}

/**
 * The one in effect (there is at most one, BR-012-08); else the latest that lapsed after being
 * paid (the page shows the lapse and the read-only date, BR-012-28); a checkout that was never
 * paid is no plan (null).
 */
export function pickDisplayedSubscription<T extends DisplayCandidate>(
  candidates: readonly T[],
): T | null {
  const inEffect = candidates.find((candidate) => isInEffect(candidate.status));
  if (inEffect) return inEffect;
  const lapsed = candidates
    .filter((candidate) => candidate.status === 'LAPSED' && candidate.firstPaidAt !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return lapsed[0] ?? null;
}
