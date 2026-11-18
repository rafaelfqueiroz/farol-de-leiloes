// AR-08: the only file that touches the subscription model. Every write that matters is ONE
// conditional update (AR-15): the sync lease is a conditional claim, the sync write is conditional
// on holding the lease, the office attach is conditional on none being attached. Filters are built
// from server state only, with `$eq` on every id and `serverOperators` on every operator (SC-10).
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import { isObjectIdString } from '../access/owner-filter.js';
import { serverOperators } from '../common/mongo/query-safety.js';
import { IN_EFFECT_STATUSES } from './domain/subscription-status.js';
import type { SyncPatch } from './domain/provider-state.js';
import type { SubscriptionStatus } from './domain/subscription-status.js';
import type { NewPendingSubscription, StoredSubscription } from './stored-subscription.js';
import { SubscriptionEntity, type SubscriptionDocument } from './schemas/subscription.schema.js';

/** MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

interface Row {
  _id: Types.ObjectId;
  officeId?: Types.ObjectId;
  buyerUserId: Types.ObjectId;
  planId: Types.ObjectId;
  planCode: string;
  activeJourneyLimit: number;
  checkoutSessionId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  status: SubscriptionStatus;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  scheduledPlanId?: Types.ObjectId;
  scheduledChangeAt?: Date;
  firstPaidAt?: Date;
  lapsedAt?: Date;
  readOnlyAt?: Date;
  provisionedAt?: Date;
  refundClaimedAt?: Date;
  refundedAt?: Date;
  syncLeaseToken?: string;
  syncLeaseUntil?: Date;
  lastSyncedAt?: Date;
}

function toStored(row: Row): StoredSubscription {
  return Object.freeze({
    id: row._id.toHexString(),
    officeId: row.officeId?.toHexString() ?? null,
    buyerUserId: row.buyerUserId.toHexString(),
    planId: row.planId.toHexString(),
    planCode: row.planCode,
    activeJourneyLimit: row.activeJourneyLimit,
    checkoutSessionId: row.checkoutSessionId ?? null,
    stripeCustomerId: row.stripeCustomerId ?? null,
    stripeSubscriptionId: row.stripeSubscriptionId ?? null,
    status: row.status,
    currentPeriodStart: row.currentPeriodStart ?? null,
    currentPeriodEnd: row.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    scheduledPlanId: row.scheduledPlanId?.toHexString() ?? null,
    scheduledChangeAt: row.scheduledChangeAt ?? null,
    firstPaidAt: row.firstPaidAt ?? null,
    lapsedAt: row.lapsedAt ?? null,
    readOnlyAt: row.readOnlyAt ?? null,
    provisionedAt: row.provisionedAt ?? null,
    refundClaimedAt: row.refundClaimedAt ?? null,
    refundedAt: row.refundedAt ?? null,
    syncLeaseToken: row.syncLeaseToken ?? null,
    syncLeaseUntil: row.syncLeaseUntil ?? null,
    lastSyncedAt: row.lastSyncedAt ?? null,
  });
}

/** What the office plan source reads of a subscription (BR-012-21, BR-012-28). */
export interface OfficeSubscriptionRow {
  readonly officeId: string;
  readonly status: SubscriptionStatus;
  readonly lapsedAt: Date | null;
  readonly firstPaidAt: Date | null;
}

/**
 * How a sync write ended:
 *  - written: stored, and the lease released in the same write;
 *  - lease_lost: the lease expired and another sync took it; nothing was written (retry);
 *  - duplicate_in_effect: the office already has another subscription in effect (BR-012-08);
 *    nothing was written.
 */
export type SyncWriteOutcome = 'written' | 'lease_lost' | 'duplicate_in_effect';

export type AttachOfficeOutcome = 'attached' | 'already_attached' | 'duplicate_in_effect';

/** Whether a failed write was the unique index on one in-effect subscription per office. */
function isInEffectDuplicate(error: unknown): boolean {
  const failure = error as { code?: unknown; keyPattern?: Record<string, unknown> } | null;
  return failure?.code === DUPLICATE_KEY && failure.keyPattern?.officeId !== undefined;
}

@Injectable()
export class SubscriptionsRepository {
  constructor(
    @InjectModel(SubscriptionEntity.name) private readonly model: Model<SubscriptionDocument>,
  ) {}

  /** BR-012-09: starts PENDING; it grants nothing until the provider confirms payment. */
  async createPending(input: NewPendingSubscription): Promise<StoredSubscription> {
    const [created] = await this.model.create([
      {
        buyerUserId: new Types.ObjectId(input.buyerUserId),
        planId: new Types.ObjectId(input.planId),
        planCode: input.planCode,
        activeJourneyLimit: input.activeJourneyLimit,
        status: 'PENDING',
        cancelAtPeriodEnd: false,
        ...(input.officeId === undefined ? {} : { officeId: new Types.ObjectId(input.officeId) }),
        ...(input.checkoutSessionId === undefined
          ? {}
          : { checkoutSessionId: input.checkoutSessionId }),
      },
    ]);
    if (!created) throw new Error('MongoDB created no subscription');
    return toStored(created.toObject() as unknown as Row);
  }

  async findById(id: string): Promise<StoredSubscription | null> {
    if (!isObjectIdString(id)) return null;
    const row = await this.model
      .findOne({ _id: { $eq: id } })
      .lean<Row>()
      .exec();
    return row ? toStored(row) : null;
  }

  async findByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<StoredSubscription | null> {
    if (typeof stripeSubscriptionId !== 'string') return null;
    const row = await this.model
      .findOne({ stripeSubscriptionId: { $eq: stripeSubscriptionId } })
      .lean<Row>()
      .exec();
    return row ? toStored(row) : null;
  }

  /**
   * BR-012-21 / BR-012-28: the subscriptions that decide the plan state of these offices, in ONE
   * query: the ones in effect and the lapsed ones that were once paid. A pending or never-paid one
   * says nothing about an office.
   */
  async findDecidingForOffices(officeIds: readonly string[]): Promise<OfficeSubscriptionRow[]> {
    const ids = officeIds.filter((id) => isObjectIdString(id));
    if (ids.length === 0) return [];
    const rows = await this.model
      .find({
        officeId: serverOperators({ $in: ids.map((id) => new Types.ObjectId(id)) }),
        $or: [
          { status: serverOperators({ $in: [...IN_EFFECT_STATUSES] }) },
          { status: { $eq: 'LAPSED' }, firstPaidAt: serverOperators({ $exists: true }) },
        ],
      })
      .select('officeId status lapsedAt firstPaidAt')
      .lean<Pick<Row, '_id' | 'officeId' | 'status' | 'lapsedAt' | 'firstPaidAt'>[]>()
      .exec();
    return rows.flatMap((row) =>
      row.officeId === undefined
        ? []
        : [
            {
              officeId: row.officeId.toHexString(),
              status: row.status,
              lapsedAt: row.lapsedAt ?? null,
              firstPaidAt: row.firstPaidAt ?? null,
            },
          ],
    );
  }

  /**
   * BR-012-13: takes the per-document sync lease in ONE conditional update. Free means no lease or
   * one that expired; of any number of concurrent callers exactly one gets the document back, the
   * others get null. The lease is a claim with a token and an end, never a held connection: a
   * crashed holder loses it by itself at `until`.
   */
  async acquireSyncLease(
    id: string,
    token: string,
    now: Date,
    until: Date,
  ): Promise<StoredSubscription | null> {
    if (!isObjectIdString(id)) return null;
    const row = await this.model
      .findOneAndUpdate(
        {
          _id: { $eq: id },
          $or: [{ syncLeaseUntil: null }, { syncLeaseUntil: serverOperators({ $lte: now }) }],
        },
        { $set: { syncLeaseToken: token, syncLeaseUntil: until } },
        { returnDocument: 'after' },
      )
      .lean<Row>()
      .exec();
    return row ? toStored(row) : null;
  }

  /** Gives the lease back, only if it is still ours. Idempotent. */
  async releaseSyncLease(id: string, token: string): Promise<void> {
    if (!isObjectIdString(id)) return;
    await this.model
      .updateOne(
        { _id: { $eq: id }, syncLeaseToken: { $eq: token } },
        { $unset: { syncLeaseToken: '', syncLeaseUntil: '' } },
      )
      .exec();
  }

  /**
   * BR-012-13: stores a sync under the lease and releases the lease in the same write. Conditional
   * on the token, so a sync whose lease expired and was taken by another writes nothing
   * ('lease_lost'): a stale read can never overwrite a newer one.
   */
  async writeSync(id: string, token: string, patch: SyncPatch): Promise<SyncWriteOutcome> {
    const set: Record<string, unknown> = {
      status: patch.status,
      stripeSubscriptionId: patch.stripeSubscriptionId,
      stripeCustomerId: patch.stripeCustomerId,
      cancelAtPeriodEnd: patch.cancelAtPeriodEnd,
      lastSyncedAt: patch.lastSyncedAt,
    };
    const unset: Record<string, ''> = { syncLeaseToken: '', syncLeaseUntil: '' };
    const optional: Record<string, Date | Types.ObjectId | null> = {
      currentPeriodStart: patch.currentPeriodStart,
      currentPeriodEnd: patch.currentPeriodEnd,
      scheduledPlanId:
        patch.scheduledPlanId === null ? null : new Types.ObjectId(patch.scheduledPlanId),
      scheduledChangeAt: patch.scheduledChangeAt,
      firstPaidAt: patch.firstPaidAt,
      lapsedAt: patch.lapsedAt,
      readOnlyAt: patch.readOnlyAt,
    };
    for (const [field, value] of Object.entries(optional)) {
      if (value === null) unset[field] = '';
      else set[field] = value;
    }
    if (patch.plan !== null) {
      // BR-012-16: the plan and the limit it copies change together, only when the price did.
      set.planId = new Types.ObjectId(patch.plan.id);
      set.planCode = patch.plan.code;
      set.activeJourneyLimit = patch.plan.activeJourneyLimit;
    }
    try {
      const result = await this.model
        .updateOne(
          { _id: { $eq: id }, syncLeaseToken: { $eq: token } },
          { $set: set, $unset: unset },
        )
        .exec();
      return result.matchedCount === 1 ? 'written' : 'lease_lost';
    } catch (error) {
      // BR-012-08: the unique index on one in-effect subscription per office refused this status.
      if (isInEffectDuplicate(error)) return 'duplicate_in_effect';
      throw error;
    }
  }

  /**
   * BR-012-07: attaches the office created for the first payment, only if none is attached yet
   * (ONE conditional update), so two deliveries racing to provision keep the first office.
   */
  async attachOffice(id: string, officeId: string, now: Date): Promise<AttachOfficeOutcome> {
    try {
      const result = await this.model
        .updateOne(
          { _id: { $eq: id }, officeId: null },
          { $set: { officeId: new Types.ObjectId(officeId), provisionedAt: now } },
        )
        .exec();
      return result.modifiedCount === 1 ? 'attached' : 'already_attached';
    } catch (error) {
      if (isInEffectDuplicate(error)) return 'duplicate_in_effect';
      throw error;
    }
  }

  /**
   * An abandoned checkout leaves nothing (acceptance criteria): removes a subscription that is
   * still PENDING and was never given a provider subscription. True when it was removed.
   */
  async deleteAbandonedPending(id: string): Promise<boolean> {
    if (!isObjectIdString(id)) return false;
    const result = await this.model
      .deleteOne({ _id: { $eq: id }, status: { $eq: 'PENDING' }, stripeSubscriptionId: null })
      .exec();
    return result.deletedCount === 1;
  }
}
