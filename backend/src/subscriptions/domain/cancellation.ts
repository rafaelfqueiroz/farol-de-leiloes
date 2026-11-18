// SPEC-012 BR-012-19, BR-012-29: what a cancel or an undo does. Pure (AR-05).
import { isInEffect, type SubscriptionStatus } from './subscription-status.js';

export type CancelDecision =
  /** Nothing is in effect: there is nothing to cancel. */
  | 'not_cancelable'
  /** Already cancelling at the period end: success, nothing to do (idempotent). */
  | 'noop'
  /** BR-012-29: full refund and end at once. */
  | 'refund_and_cancel'
  /** BR-012-19: stop renewal; the plan stays in effect until the paid period ends. */
  | 'cancel_at_period_end';

export function decideCancel(subscription: {
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  /**
   * The right of withdrawal applies (BR-012-29), judged at the instant the member's cancel was
   * first accepted (`refundRequestedAt`) when there is one, so a retry after the window of a
   * request made inside it still completes.
   */
  refundEligible: boolean;
  /** The refund was made (BR-012-29) but the subscription is still in effect: a crash between. */
  refunded: boolean;
}): CancelDecision {
  if (!isInEffect(subscription.status)) return 'not_cancelable';
  // The money went back: the subscription must end now, whatever the window says any more.
  if (subscription.refunded) return 'refund_and_cancel';
  // Eligibility comes BEFORE "already cancelling": a member who chose the period end on day 2 and
  // changes their mind on day 5 still has the right of withdrawal (CDC art. 49).
  if (subscription.refundEligible) return 'refund_and_cancel';
  return subscription.cancelAtPeriodEnd ? 'noop' : 'cancel_at_period_end';
}

export type UndoDecision =
  /** Not in effect, or the paid period has ended: it can no longer be undone. */
  | 'not_changeable'
  /** Renewal was never stopped: success, nothing to do. */
  | 'noop'
  | 'undo';

/**
 * BR-012-19: a member can undo the cancellation before the period ends. The period is the
 * half-open interval up to `currentPeriodEnd`: at exactly the end it is over. A subscription with
 * no known end is treated as not ended (the provider is the authority and refuses if it is).
 */
export function decideUndoCancel(
  subscription: {
    status: SubscriptionStatus;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
  },
  now: Date,
): UndoDecision {
  if (!isInEffect(subscription.status)) return 'not_changeable';
  if (!subscription.cancelAtPeriodEnd) return 'noop';
  const { currentPeriodEnd } = subscription;
  if (currentPeriodEnd !== null && now.getTime() >= currentPeriodEnd.getTime()) {
    return 'not_changeable';
  }
  return 'undo';
}
