import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';
import {
  IN_EFFECT_STATUSES,
  SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from '../domain/subscription-status.js';

/**
 * SPEC-012 BR-012-06..BR-012-14: the subscription of an OFFICE (not of the member who paid,
 * BR-012-06). Its `_id` is the subscription ref we put on the provider's checkout and subscription,
 * so a provider event can always be traced back to it. Money-free: amounts live at the provider.
 *
 * Created PENDING when checkout starts, with no `officeId` for a first subscription (the office is
 * created once the provider confirms payment, BR-012-07). Every later change is a sync from the
 * provider's current state (BR-012-13) written under the sync lease; nothing else writes status.
 */
@Schema({ collection: 'subscriptions', timestamps: true })
export class SubscriptionEntity {
  /** Absent until the first payment is confirmed and the office exists (BR-012-07). */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  officeId?: Types.ObjectId;

  /** The account that started the checkout: the future sole member of the new office. */
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  buyerUserId!: Types.ObjectId;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  planId!: Types.ObjectId;

  /** The plan's code at the time it was chosen or last changed (plan edits never reach it). */
  @Prop({ required: true, type: String })
  planCode!: string;

  /**
   * Copied from the plan when the subscription is made or when the provider bills another price
   * (BR-012-04, BR-012-16): editing the catalog never touches an existing subscriber.
   */
  @Prop({ required: true, type: Number, min: 1, validate: Number.isInteger })
  activeJourneyLimit!: number;

  @Prop({ type: String })
  checkoutSessionId?: string;

  @Prop({ type: String })
  stripeCustomerId?: string;

  @Prop({ type: String })
  stripeSubscriptionId?: string;

  @Prop({ required: true, type: String, enum: SUBSCRIPTION_STATUSES, default: 'PENDING' })
  status!: SubscriptionStatus;

  @Prop({ type: Date })
  currentPeriodStart?: Date;

  @Prop({ type: Date })
  currentPeriodEnd?: Date;

  @Prop({ required: true, type: Boolean, default: false })
  cancelAtPeriodEnd!: boolean;

  /** A downgrade scheduled for the start of the next period (BR-012-17). */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  scheduledPlanId?: Types.ObjectId;

  @Prop({ type: Date })
  scheduledChangeAt?: Date;

  /** The provider-confirmed first payment: starts the refund window (BR-012-29). Set once. */
  @Prop({ type: Date })
  firstPaidAt?: Date;

  /** When the subscription lapsed: starts the grace period (BR-012-21). Cleared on leaving it. */
  @Prop({ type: Date })
  lapsedAt?: Date;

  /**
   * `lapsedAt` plus the grace days: a copy for display, refreshed by every sync. The authority is
   * `lapsedAt` and the current SUBSCRIPTION_GRACE_DAYS, computed on every read (BR-012-28).
   */
  @Prop({ type: Date })
  readOnlyAt?: Date;

  /** When the office was created or attached for this subscription (BR-012-07). */
  @Prop({ type: Date })
  provisionedAt?: Date;

  /** The refund claim (BR-012-29, PR2): re-claimable after 5 minutes. */
  @Prop({ type: Date })
  refundClaimedAt?: Date;

  @Prop({ type: Date })
  refundedAt?: Date;

  /** The sync lease: one sync of this document at a time (BR-012-13, ADR-005). */
  @Prop({ type: String })
  syncLeaseToken?: string;

  @Prop({ type: Date })
  syncLeaseUntil?: Date;

  /**
   * A delivery that could not take the lease sets this while the lease is live; the holder reads
   * the provider again after its write and clears it (BR-012-13, ADR-005).
   */
  @Prop({ type: Date })
  syncRequestedAt?: Date;

  @Prop({ type: Date })
  lastSyncedAt?: Date;
}

export type SubscriptionDocument = HydratedDocument<SubscriptionEntity>;

export const SubscriptionSchema = SchemaFactory.createForClass(SubscriptionEntity);

// Built in production by migration 0006-subscription-indexes (AR-29, DV-34), whose unit spec holds
// it equal to these.
// BR-012-13: a provider subscription is stored once. Sparse: a PENDING one has none yet.
SubscriptionSchema.index({ stripeSubscriptionId: 1 }, { unique: true, sparse: true });
SubscriptionSchema.index({ checkoutSessionId: 1 }, { unique: true, sparse: true });
// BR-012-08: at most one subscription in effect per office. A race of two paid checkouts ends
// with one winner here; the other is cancelled at the provider (SubscriptionsService). `officeId`
// must exist: a first subscription has none yet, and absent values would all collide as null.
SubscriptionSchema.index(
  { officeId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      officeId: { $exists: true },
      status: { $in: [...IN_EFFECT_STATUSES] },
    },
    name: 'one_in_effect_subscription_per_office',
  },
);
// AR-27: the office's history (OfficePlanSource reads its in-effect and lapsed ones in one $in).
SubscriptionSchema.index({ officeId: 1, createdAt: -1 });

// AR-16: keyed by the office and the provider ids, never listed per owner through a client API
// (BR-012-11's billing view is a service call that resolves the office from the caller's own
// memberships, PR2). Holds no amounts; inventoried in SECURITY §9 (SC-25).
markIsolation(SubscriptionSchema, {
  kind: 'internal',
  reason:
    'Office subscriptions (SPEC-012): operations records keyed by office and provider ids, written only by the provider sync and read by the plan source and the billing service, never listed per owner or account',
});
