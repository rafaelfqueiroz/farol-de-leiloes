// SPEC-012 BR-012-13 (ADR-005): the stored subscription is always the provider's current state.
// `reconcile` turns what the provider says now into the fields to store; it reads nothing else
// that is not an argument (AR-05), so it is the same for a first delivery, a replay and a late
// event: the result depends on the snapshot and the stored facts, never on which event woke us.
import { readOnlyAtOf } from './grace.js';
import { isInEffect, type SubscriptionStatus } from './subscription-status.js';

/** The provider's names for a subscription's state (the port's `ProviderSubscriptionStatus`). */
export type ProviderStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

/** What `reconcile` reads of the provider's subscription (the port's `ProviderSubscription`). */
export interface ProviderSnapshot {
  readonly id: string;
  readonly status: ProviderStatus;
  readonly customerId: string;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly scheduledChangeAt: Date | null;
  readonly latestInvoicePaidAt: Date | null;
  readonly endedAt: Date | null;
}

/**
 * BR-012-12: provider state → ours.
 *
 *   active | trialing                 → ACTIVE, or CANCELING when renewal was stopped (BR-012-19)
 *   past_due                          → PAST_DUE (still in effect, BR-012-20)
 *   unpaid | canceled | paused
 *   | incomplete_expired              → LAPSED
 *   incomplete                        → PENDING (payment not confirmed, BR-012-09)
 *
 * A past_due subscription stays PAST_DUE even when renewal was stopped: the failed charge is what
 * the office must see.
 */
export function statusFromProvider(
  status: ProviderStatus,
  cancelAtPeriodEnd: boolean,
): SubscriptionStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return cancelAtPeriodEnd ? 'CANCELING' : 'ACTIVE';
    case 'past_due':
      return 'PAST_DUE';
    case 'incomplete':
      return 'PENDING';
    case 'unpaid':
    case 'canceled':
    case 'paused':
    case 'incomplete_expired':
      return 'LAPSED';
    default:
      // A status the provider added after this code: a fault (the event is retried and someone is
      // told), never a guess about whether an office is paid up.
      throw new Error('Unknown provider subscription status');
  }
}

/** The facts already stored that the next state depends on. */
export interface StoredFacts {
  readonly status: SubscriptionStatus;
  readonly lapsedAt: Date | null;
  readonly firstPaidAt: Date | null;
}

/** A plan a subscription can be on, reduced to what is copied onto it (BR-012-04). */
export interface PlanFacts {
  readonly id: string;
  readonly code: string;
  readonly activeJourneyLimit: number;
}

export interface ReconcileInput {
  readonly current: StoredFacts;
  readonly provider: ProviderSnapshot;
  /**
   * The plan the provider is billing now, ONLY when it is not the plan the subscription is on
   * (the item's price changed). With `pending_if_incomplete` the provider changes the price only
   * once the prorated amount is paid, so an upgrade reaches the limit when it is paid (BR-012-16).
   */
  readonly paidPlan: PlanFacts | null;
  /** The plan of the provider's scheduled next-period price, if there is one (BR-012-17). */
  readonly scheduledPlan: PlanFacts | null;
  readonly now: Date;
  readonly graceDays: number;
}

/** The fields to store; a `null` clears the stored value. */
export interface SyncPatch {
  readonly status: SubscriptionStatus;
  readonly stripeSubscriptionId: string;
  readonly stripeCustomerId: string;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  /** Set only when the plan changed (BR-012-16); `null` leaves planId, planCode and limit alone. */
  readonly plan: PlanFacts | null;
  readonly scheduledPlanId: string | null;
  readonly scheduledChangeAt: Date | null;
  readonly firstPaidAt: Date | null;
  readonly lapsedAt: Date | null;
  readonly readOnlyAt: Date | null;
  readonly lastSyncedAt: Date;
}

/**
 * Entering LAPSED stamps `lapsedAt` (the instant the provider ended it when it says so, else now),
 * staying LAPSED keeps it, leaving it clears it (BR-012-21: "subscribing again restores the limit
 * at once"). A provider instant in the future is a clock disagreement: it never counts, now does.
 */
function lapsedAtOf(input: ReconcileInput, next: SubscriptionStatus): Date | null {
  if (next !== 'LAPSED') return null;
  if (input.current.status === 'LAPSED' && input.current.lapsedAt !== null) {
    return input.current.lapsedAt;
  }
  const ended = input.provider.endedAt;
  return ended !== null && ended.getTime() <= input.now.getTime() ? ended : input.now;
}

/**
 * The first confirmed payment (BR-012-29: it starts the refund window), stored once: the
 * provider's paid time of the latest invoice, or now when the provider gave none. A subscription
 * that went from pending straight to ended is still a paid one when its invoice was paid.
 */
function firstPaidAtOf(input: ReconcileInput, next: SubscriptionStatus): Date | null {
  if (input.current.firstPaidAt !== null) return input.current.firstPaidAt;
  const paid = input.provider.latestInvoicePaidAt;
  if (isInEffect(next)) return paid ?? input.now;
  return next === 'LAPSED' ? paid : null;
}

export function reconcile(input: ReconcileInput): SyncPatch {
  const { provider, now, graceDays } = input;
  const status = statusFromProvider(provider.status, provider.cancelAtPeriodEnd);
  const lapsedAt = lapsedAtOf(input, status);
  const { scheduledPlan } = input;
  const { scheduledChangeAt } = provider;
  const scheduled = scheduledPlan !== null && scheduledChangeAt !== null;
  return {
    status,
    stripeSubscriptionId: provider.id,
    stripeCustomerId: provider.customerId,
    cancelAtPeriodEnd: provider.cancelAtPeriodEnd,
    currentPeriodStart: provider.currentPeriodStart,
    currentPeriodEnd: provider.currentPeriodEnd,
    plan: input.paidPlan,
    scheduledPlanId: scheduled ? scheduledPlan.id : null,
    scheduledChangeAt: scheduled ? scheduledChangeAt : null,
    firstPaidAt: firstPaidAtOf(input, status),
    lapsedAt,
    readOnlyAt: lapsedAt === null ? null : readOnlyAtOf(lapsedAt, graceDays),
    lastSyncedAt: now,
  };
}
