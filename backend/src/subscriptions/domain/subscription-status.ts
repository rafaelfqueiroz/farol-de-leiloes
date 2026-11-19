// SPEC-012 BR-012-12: the five states of a subscription. Pure (AR-05, AR-06): the plan entitlements
// and limits are a critical module (TS-24, 100% branch).

export const SUBSCRIPTION_STATUSES = [
  /** Checkout started, payment not confirmed by the provider (BR-012-09). */
  'PENDING',
  'ACTIVE',
  /** A renewal charge failed and the provider is retrying; still in effect (BR-012-20). */
  'PAST_DUE',
  /** Cancellation requested; in effect until the paid period ends (BR-012-19). */
  'CANCELING',
  /** No longer in effect (BR-012-21). */
  'LAPSED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * BR-012-08: at most one subscription per office is in effect. The partial unique index of the
 * `subscriptions` collection (migration 0006) is built on exactly this list.
 */
export const IN_EFFECT_STATUSES = ['ACTIVE', 'PAST_DUE', 'CANCELING'] as const;
export type InEffectStatus = (typeof IN_EFFECT_STATUSES)[number];

export function isInEffect(status: SubscriptionStatus): status is InEffectStatus {
  return (IN_EFFECT_STATUSES as readonly SubscriptionStatus[]).includes(status);
}

/**
 * BR-012-21: the active-journey limit is the copy the subscription holds while it is in effect and
 * zero from the moment it lapses (and while it is only pending), so no new journey can start.
 */
export function effectiveJourneyLimit(subscription: {
  status: SubscriptionStatus;
  activeJourneyLimit: number;
}): number {
  return isInEffect(subscription.status) ? subscription.activeJourneyLimit : 0;
}
