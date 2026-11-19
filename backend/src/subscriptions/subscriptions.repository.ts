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

/** The statuses of a subscription that has not lapsed. */
const NOT_LAPSED: SubscriptionStatus[] = ['PENDING', ...IN_EFFECT_STATUSES];

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
  refundRequestedAt?: Date;
  firstPaymentFree?: boolean;
  lastReconcileFailedAt?: Date;
  refundedAt?: Date;
  syncLeaseToken?: string;
  syncLeaseUntil?: Date;
  syncRequestedAt?: Date;
  lastSyncedAt?: Date;
  openCheckoutKey?: string;
  createdAt: Date;
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
    firstPaymentFree: row.firstPaymentFree ?? false,
    refundClaimedAt: row.refundClaimedAt ?? null,
    refundRequestedAt: row.refundRequestedAt ?? null,
    refundedAt: row.refundedAt ?? null,
    syncLeaseToken: row.syncLeaseToken ?? null,
    syncLeaseUntil: row.syncLeaseUntil ?? null,
    lastSyncedAt: row.lastSyncedAt ?? null,
    createdAt: row.createdAt,
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

/**
 * What a sync write did, and (for 'written') whether another delivery asked for a re-sync while
 * the lease was held: `dirty` is read from the document as it was at the instant of the write, so
 * a mark that landed before the write is seen here and one that lands after it finds the lease
 * already released (BR-012-13, ADR-005).
 */
export interface SyncWriteResult {
  readonly outcome: SyncWriteOutcome;
  readonly dirty: boolean;
}

export type AttachOfficeOutcome = 'attached' | 'already_attached' | 'duplicate_in_effect';

/** BR-012-07, BR-012-08: another checkout of the same office, or buyer, is open. */
export class OpenCheckoutExistsError extends Error {
  constructor() {
    super('Another checkout of this office or buyer is open');
    this.name = 'OpenCheckoutExistsError';
  }
}

/** Whether a failed write was the unique index on one open checkout per key. */
function isOpenCheckoutDuplicate(error: unknown): boolean {
  const failure = error as { code?: unknown; keyPattern?: Record<string, unknown> } | null;
  return failure?.code === DUPLICATE_KEY && failure.keyPattern?.openCheckoutKey !== undefined;
}

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

  /**
   * BR-012-09: starts PENDING; it grants nothing until the provider confirms payment. Throws
   * `OpenCheckoutExistsError` when the unique open-checkout key is taken (BR-012-07, BR-012-08).
   */
  async createPending(input: NewPendingSubscription): Promise<StoredSubscription> {
    try {
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
          ...(input.openCheckoutKey === undefined
            ? {}
            : { openCheckoutKey: input.openCheckoutKey }),
        },
      ]);
      if (!created) throw new Error('MongoDB created no subscription');
      return toStored(created.toObject() as unknown as Row);
    } catch (error) {
      if (isOpenCheckoutDuplicate(error)) throw new OpenCheckoutExistsError();
      throw error;
    }
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
        // A mark left by a holder that crashed is stale: this holder reads the provider afresh.
        {
          $set: { syncLeaseToken: token, syncLeaseUntil: until },
          $unset: { syncRequestedAt: '' },
        },
        { returnDocument: 'after' },
      )
      .lean<Row>()
      .exec();
    return row ? toStored(row) : null;
  }

  /**
   * BR-012-13: a delivery that cannot take the lease asks the holder to read the provider once
   * more AFTER this event, in ONE conditional update that matches only while a lease is live.
   * True when the mark landed: the holder's next read covers the caller's event. False when the
   * lease was just released or has expired: the caller must try to take it itself.
   */
  async markSyncRequested(id: string, now: Date): Promise<boolean> {
    if (!isObjectIdString(id)) return false;
    const result = await this.model
      .updateOne(
        { _id: { $eq: id }, syncLeaseUntil: serverOperators({ $gt: now }) },
        { $set: { syncRequestedAt: now } },
      )
      .exec();
    return result.matchedCount === 1;
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
   * ('lease_lost'): a stale read can never overwrite a newer one. The write clears the re-sync
   * mark and answers whether it was set (`dirty`): the update returns the document as it was just
   * before, so a mark either landed before this write (seen here) or after the release (it then
   * matched nothing and its sender took the lease itself).
   */
  async writeSync(id: string, token: string, patch: SyncPatch): Promise<SyncWriteResult> {
    const set: Record<string, unknown> = {
      status: patch.status,
      stripeSubscriptionId: patch.stripeSubscriptionId,
      stripeCustomerId: patch.stripeCustomerId,
      cancelAtPeriodEnd: patch.cancelAtPeriodEnd,
      lastSyncedAt: patch.lastSyncedAt,
    };
    const unset: Record<string, ''> = {
      syncLeaseToken: '',
      syncLeaseUntil: '',
      syncRequestedAt: '',
      // A record that was read is no longer one the reconcile job cannot read (ADR-005).
      lastReconcileFailedAt: '',
    };
    // BR-012-07, BR-012-08: the open-checkout key is held from the checkout until the office is
    // attached (attachOffice) or the subscription lapses; a subscription that is in effect keeps
    // its office's key, so a second checkout of the office cannot start while it lives.
    if (patch.status === 'LAPSED') unset.openCheckoutKey = '';
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
    if (patch.firstPaidAt !== null) set.firstPaymentFree = patch.firstPaymentFree;
    if (patch.plan !== null) {
      // BR-012-16: the plan and the limit it copies change together, only when the price did.
      set.planId = new Types.ObjectId(patch.plan.id);
      set.planCode = patch.plan.code;
      set.activeJourneyLimit = patch.plan.activeJourneyLimit;
    }
    try {
      const before = await this.model
        .findOneAndUpdate(
          { _id: { $eq: id }, syncLeaseToken: { $eq: token } },
          { $set: set, $unset: unset },
          { returnDocument: 'before' },
        )
        .select('syncRequestedAt')
        .lean<Pick<Row, '_id' | 'syncRequestedAt'>>()
        .exec();
      if (before === null) return { outcome: 'lease_lost', dirty: false };
      return { outcome: 'written', dirty: before.syncRequestedAt !== undefined };
    } catch (error) {
      // BR-012-08: the unique index on one in-effect subscription per office refused this status.
      if (isInEffectDuplicate(error)) return { outcome: 'duplicate_in_effect', dirty: false };
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
          {
            $set: { officeId: new Types.ObjectId(officeId), provisionedAt: now },
            // The buyer's open-checkout key was kept until now (one office per buyer, BR-012-07).
            $unset: { openCheckoutKey: '' },
          },
        )
        .exec();
      return result.modifiedCount === 1 ? 'attached' : 'already_attached';
    } catch (error) {
      if (isInEffectDuplicate(error)) return 'duplicate_in_effect';
      throw error;
    }
  }

  /**
   * BR-012-08: the subscription of this office that is in effect, other than `exceptId`. Read by
   * the duplicate resolution to see what the incoming subscription collided with.
   */
  async findInEffectForOffice(
    officeId: string,
    exceptId: string,
  ): Promise<StoredSubscription | null> {
    if (!isObjectIdString(officeId) || !isObjectIdString(exceptId)) return null;
    const row = await this.model
      .findOne({
        officeId: { $eq: new Types.ObjectId(officeId) },
        status: serverOperators({ $in: [...IN_EFFECT_STATUSES] }),
        _id: serverOperators({ $ne: new Types.ObjectId(exceptId) }),
      })
      .lean<Row>()
      .exec();
    return row ? toStored(row) : null;
  }

  /**
   * An abandoned checkout leaves nothing (acceptance criteria): removes the subscription of this
   * checkout session when it is still PENDING and was never given a provider subscription. True
   * when it was removed. Matched by the session id, which only that checkout carries.
   */
  async deleteAbandonedPending(checkoutSessionId: string): Promise<boolean> {
    if (typeof checkoutSessionId !== 'string' || checkoutSessionId.length === 0) return false;
    const result = await this.model
      .deleteOne({
        checkoutSessionId: { $eq: checkoutSessionId },
        status: { $eq: 'PENDING' },
        stripeSubscriptionId: null,
      })
      .exec();
    return result.deletedCount === 1;
  }

  // ---- Billing (SPEC-012 PR2) ----------------------------------------------------------------

  /** The open checkout that holds this key (`openCheckoutKey()`), if any. */
  async findOpenCheckout(key: string): Promise<StoredSubscription | null> {
    if (typeof key !== 'string') return null;
    const row = await this.model
      .findOne({ openCheckoutKey: { $eq: key } })
      .lean<Row>()
      .exec();
    return row ? toStored(row) : null;
  }

  /**
   * Stores the provider's checkout session (and customer) on the record right after the session
   * was created, so `checkout.session.expired` can find it (ADR-005). Only a PENDING record that
   * has no session yet takes it. True when stored.
   */
  async setCheckoutSession(
    id: string,
    checkoutSessionId: string,
    stripeCustomerId: string,
  ): Promise<boolean> {
    if (!isObjectIdString(id)) return false;
    const result = await this.model
      .updateOne(
        { _id: { $eq: id }, status: { $eq: 'PENDING' }, checkoutSessionId: null },
        { $set: { checkoutSessionId, stripeCustomerId } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /**
   * Removes a checkout that never got a provider subscription (a failed or replaced checkout).
   * Matches only a PENDING record with no provider subscription, so a paid one is never removed.
   */
  async deletePendingById(id: string): Promise<boolean> {
    if (!isObjectIdString(id)) return false;
    const result = await this.model
      .deleteOne({ _id: { $eq: id }, status: { $eq: 'PENDING' }, stripeSubscriptionId: null })
      .exec();
    return result.deletedCount === 1;
  }

  /** BR-012-08: the subscription of this office that is in effect now. */
  async findInEffectByOffice(officeId: string): Promise<StoredSubscription | null> {
    if (!isObjectIdString(officeId)) return null;
    const row = await this.model
      .findOne({
        officeId: { $eq: new Types.ObjectId(officeId) },
        status: serverOperators({ $in: [...IN_EFFECT_STATUSES] }),
      })
      .lean<Row>()
      .exec();
    return row ? toStored(row) : null;
  }

  /** BR-012-11: the latest subscriptions of an office, newest first (the plan page picks one). */
  async findRecentForOffice(officeId: string, limit: number): Promise<StoredSubscription[]> {
    if (!isObjectIdString(officeId)) return [];
    const rows = await this.model
      .find({ officeId: { $eq: new Types.ObjectId(officeId) } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean<Row[]>()
      .exec();
    return rows.map(toStored);
  }

  /** The provider customer an office already has (its latest subscription that has one). */
  async findCustomerIdOfOffice(officeId: string): Promise<string | null> {
    if (!isObjectIdString(officeId)) return null;
    const row = await this.model
      .findOne({
        officeId: { $eq: new Types.ObjectId(officeId) },
        stripeCustomerId: serverOperators({ $exists: true }),
      })
      .sort({ createdAt: -1, _id: -1 })
      .select('stripeCustomerId')
      .lean<Pick<Row, '_id' | 'stripeCustomerId'>>()
      .exec();
    return row?.stripeCustomerId ?? null;
  }

  /**
   * BR-012-29: whether the office had another subscription that was paid BEFORE `before` (the
   * first payment of the one being asked about): then that one is not its first.
   */
  async existsEarlierPaid(officeId: string, exceptId: string, before: Date): Promise<boolean> {
    if (!isObjectIdString(officeId) || !isObjectIdString(exceptId)) return false;
    const found = await this.model
      .exists({
        officeId: { $eq: new Types.ObjectId(officeId) },
        _id: serverOperators({ $ne: new Types.ObjectId(exceptId) }),
        firstPaidAt: serverOperators({ $lt: before }),
        // BR-012-29: a first subscription that charged nothing (100% coupon) is not an earlier paid one.
        firstPaymentFree: serverOperators({ $ne: true }),
      })
      .exec();
    return found !== null;
  }

  /**
   * BR-012-29: claims the refund of an in-effect subscription in ONE conditional update. Exactly
   * one of any number of concurrent callers gets true. A claim older than `staleBefore` (a caller
   * that died before it refunded) can be taken again; the refund itself is idempotent by key.
   */
  async claimRefund(id: string, now: Date, staleBefore: Date): Promise<boolean> {
    if (!isObjectIdString(id)) return false;
    const result = await this.model
      .updateOne(
        {
          _id: { $eq: id },
          status: serverOperators({ $in: [...IN_EFFECT_STATUSES] }),
          refundedAt: null,
          $or: [
            { refundClaimedAt: null },
            { refundClaimedAt: serverOperators({ $lte: staleBefore }) },
          ],
        },
        // $min: the first accepted request stays, whatever claims follow (BR-012-29).
        { $set: { refundClaimedAt: now }, $min: { refundRequestedAt: now } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** Records that the refund was made, once. True on the call that recorded it. */
  async markRefunded(id: string, now: Date): Promise<boolean> {
    if (!isObjectIdString(id)) return false;
    const result = await this.model
      .updateOne({ _id: { $eq: id }, refundedAt: null }, { $set: { refundedAt: now } })
      .exec();
    return result.modifiedCount === 1;
  }

  /**
   * ADR-005: the records the reconcile job re-reads, oldest sync first and bounded: those with a
   * provider subscription that are not lapsed, or that lapsed since `lapsedSince`, and were last
   * synced before `staleBefore` (or never).
   */
  async findIdsToReconcile(args: {
    staleBefore: Date;
    lapsedSince: Date;
    limit: number;
  }): Promise<Array<{ id: string; status: SubscriptionStatus }>> {
    const stale = {
      $or: [{ lastSyncedAt: null }, { lastSyncedAt: serverOperators({ $lt: args.staleBefore }) }],
    };
    const rows = await this.model
      .find({
        stripeSubscriptionId: serverOperators({ $exists: true }),
        $and: [
          stale,
          {
            $or: [
              { status: serverOperators({ $in: NOT_LAPSED }) },
              { status: { $eq: 'LAPSED' }, lapsedAt: serverOperators({ $gte: args.lapsedSince }) },
            ],
          },
        ],
      })
      // Failures sort last (never-failed records have no value, which sorts first), so a record the
      // job can never read cannot starve the batch (ADR-005).
      .sort({ lastReconcileFailedAt: 1, lastSyncedAt: 1, _id: 1 })
      .limit(args.limit)
      .select('_id status')
      .lean<Array<Pick<Row, '_id' | 'status'>>>()
      .exec();
    return rows.map((row) => ({ id: row._id.toHexString(), status: row.status }));
  }

  /** ADR-005: the reconcile job could not read this record; it sorts after the others next time. */
  async markReconcileFailed(id: string, now: Date): Promise<void> {
    if (!isObjectIdString(id)) return;
    await this.model
      .updateOne({ _id: { $eq: id } }, { $set: { lastReconcileFailedAt: now } })
      .exec();
  }

  /**
   * BR-012-29: gives the refund claim back after a failure BEFORE the refund was confirmed, so the
   * next attempt does not wait for the claim to expire. Only the holder (the claim instant it took)
   * releases it; `refundRequestedAt` stays, so the right of withdrawal is still judged at the
   * request.
   */
  async releaseRefundClaim(id: string, claimedAt: Date): Promise<void> {
    if (!isObjectIdString(id)) return;
    await this.model
      .updateOne(
        { _id: { $eq: id }, refundClaimedAt: { $eq: claimedAt } },
        { $unset: { refundClaimedAt: '' } },
      )
      .exec();
  }

  /**
   * BR-012-29: subscriptions still in effect whose refund was requested or made but whose end was
   * not completed ("refunded but still active"): the job finishes them. Bounded.
   */
  async findRefundsToFinish(limit: number): Promise<StoredSubscription[]> {
    const rows = await this.model
      .find({
        status: serverOperators({ $in: [...IN_EFFECT_STATUSES] }),
        $or: [
          { refundedAt: serverOperators({ $exists: true }) },
          { refundRequestedAt: serverOperators({ $exists: true }) },
        ],
      })
      .sort({ _id: 1 })
      .limit(limit)
      .lean<Row[]>()
      .exec();
    return rows.map(toStored);
  }

  /**
   * ADR-005: checkouts with a provider session but no provider subscription, created before
   * `before`: a buyer may have paid one whose events never reached us. The job asks the provider.
   */
  async findPendingWithSession(before: Date, limit: number): Promise<StoredSubscription[]> {
    const rows = await this.model
      .find({
        status: { $eq: 'PENDING' },
        stripeSubscriptionId: null,
        checkoutSessionId: serverOperators({ $exists: true }),
        createdAt: serverOperators({ $lt: before }),
      })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean<Row[]>()
      .exec();
    return rows.map(toStored);
  }

  /**
   * A checkout whose creation never finished (no session id was ever stored) and is older than
   * `before` leaves nothing. A record WITH a session is never purged here: whether it was paid is
   * the provider's to say (the reconcile job asks it). Returns how many were removed.
   */
  async purgeOrphanedPending(before: Date): Promise<number> {
    const result = await this.model
      .deleteMany({
        status: { $eq: 'PENDING' },
        stripeSubscriptionId: null,
        checkoutSessionId: null,
        createdAt: serverOperators({ $lt: before }),
      })
      .exec();
    return result.deletedCount;
  }

  /** BR-012-07: a first subscription of this buyer that is in effect and has no office yet. */
  async findInEffectByBuyerWithoutOffice(buyerUserId: string): Promise<StoredSubscription | null> {
    if (!isObjectIdString(buyerUserId)) return null;
    const row = await this.model
      .findOne({
        buyerUserId: { $eq: new Types.ObjectId(buyerUserId) },
        officeId: null,
        status: serverOperators({ $in: [...IN_EFFECT_STATUSES] }),
      })
      .lean<Row>()
      .exec();
    return row ? toStored(row) : null;
  }

  /** The provider customer this buyer already has (their latest record that carries one). */
  async findCustomerIdOfBuyer(buyerUserId: string): Promise<string | null> {
    if (!isObjectIdString(buyerUserId)) return null;
    const row = await this.model
      .findOne({
        buyerUserId: { $eq: new Types.ObjectId(buyerUserId) },
        stripeCustomerId: serverOperators({ $exists: true }),
      })
      .sort({ createdAt: -1, _id: -1 })
      .select('stripeCustomerId')
      .lean<Pick<Row, '_id' | 'stripeCustomerId'>>()
      .exec();
    return row?.stripeCustomerId ?? null;
  }
}
