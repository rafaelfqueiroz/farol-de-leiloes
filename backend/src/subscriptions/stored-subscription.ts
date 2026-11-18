// SPEC-012: a subscription as the service layer sees it, detached from its document (ids as hex
// strings, absent values as null). Money-free (the amounts live at the provider).
import type { SubscriptionStatus } from './domain/subscription-status.js';

export interface StoredSubscription {
  /** The subscription ref we put on the provider's checkout and subscription. */
  readonly id: string;
  readonly officeId: string | null;
  readonly buyerUserId: string;
  readonly planId: string;
  readonly planCode: string;
  readonly activeJourneyLimit: number;
  readonly checkoutSessionId: string | null;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly status: SubscriptionStatus;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly scheduledPlanId: string | null;
  readonly scheduledChangeAt: Date | null;
  readonly firstPaidAt: Date | null;
  readonly lapsedAt: Date | null;
  readonly readOnlyAt: Date | null;
  readonly provisionedAt: Date | null;
  readonly refundClaimedAt: Date | null;
  readonly refundedAt: Date | null;
  readonly syncLeaseToken: string | null;
  readonly syncLeaseUntil: Date | null;
  readonly lastSyncedAt: Date | null;
}

/** What starting a checkout stores (PR2 calls it; the sync specs seed with it). */
export interface NewPendingSubscription {
  readonly buyerUserId: string;
  readonly planId: string;
  readonly planCode: string;
  readonly activeJourneyLimit: number;
  /** Absent for a first subscription: the office does not exist yet (BR-012-07). */
  readonly officeId?: string;
  readonly checkoutSessionId?: string;
}
