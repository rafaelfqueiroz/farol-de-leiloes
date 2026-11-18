import { isInEffect } from '../../src/subscriptions/domain/subscription-status.js';
import type { SyncPatch } from '../../src/subscriptions/domain/provider-state.js';
import {
  type AttachOfficeOutcome,
  OpenCheckoutExistsError,
  type OfficeSubscriptionRow,
  type SubscriptionsRepository,
  type SyncWriteResult,
} from '../../src/subscriptions/subscriptions.repository.js';
import { DEFAULT_FAKE_NOW } from './fake-clock.js';
import type {
  NewPendingSubscription,
  StoredSubscription,
} from '../../src/subscriptions/stored-subscription.js';

type Port<T> = { [K in keyof T]: T[K] };

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * TS-03: an in-memory fake of the subscription repository with the semantics the service relies on:
 * the lease is a conditional claim, the sync write is conditional on the token, and an in-effect
 * subscription of an office the index would refuse is refused too ('duplicate_in_effect'). The
 * MongoDB behaviour itself (the real conditional updates under concurrency, the partial unique
 * index) is proven in test/integration/subscriptions-repositories.spec.ts (TS-02).
 */
export class FakeSubscriptionsRepository implements Port<SubscriptionsRepository> {
  readonly rows = new Map<string, Mutable<StoredSubscription>>();
  /** The ids a delivery asked to be read again (the dirty mark), cleared by the write. */
  readonly requested = new Set<string>();
  /** The open-checkout key of each record that holds one (BR-012-07, BR-012-08). */
  readonly openKeys = new Map<string, string>();
  /** When the reconcile job last failed to read a record (failures sort last). */
  readonly reconcileFailures = new Map<string, Date>();
  private sequence = 0;

  /** `now` stamps `createdAt`; a spec passes its clock. */
  constructor(private readonly now: () => Date = () => DEFAULT_FAKE_NOW) {}

  /** The stored subscription, for assertions. */
  get(id: string): StoredSubscription {
    const row = this.rows.get(id);
    if (!row) throw new Error(`no subscription ${id}`);
    return { ...row };
  }

  async createPending(input: NewPendingSubscription): Promise<StoredSubscription> {
    // The partial unique index on the open-checkout key.
    if (input.openCheckoutKey !== undefined) {
      const taken = [...this.openKeys.values()].includes(input.openCheckoutKey);
      if (taken) throw new OpenCheckoutExistsError();
    }
    this.sequence += 1;
    const id = `64b7f0000000000000dd${String(this.sequence).padStart(4, '0')}`;
    const row: Mutable<StoredSubscription> = {
      id,
      officeId: input.officeId ?? null,
      buyerUserId: input.buyerUserId,
      planId: input.planId,
      planCode: input.planCode,
      activeJourneyLimit: input.activeJourneyLimit,
      checkoutSessionId: input.checkoutSessionId ?? null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      status: 'PENDING',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      scheduledPlanId: null,
      scheduledChangeAt: null,
      firstPaidAt: null,
      firstPaymentFree: false,
      lapsedAt: null,
      readOnlyAt: null,
      provisionedAt: null,
      refundClaimedAt: null,
      refundRequestedAt: null,
      refundedAt: null,
      syncLeaseToken: null,
      syncLeaseUntil: null,
      lastSyncedAt: null,
      createdAt: new Date(this.now().getTime()),
    };
    this.rows.set(id, row);
    if (input.openCheckoutKey !== undefined) this.openKeys.set(id, input.openCheckoutKey);
    return { ...row };
  }

  async findById(id: string): Promise<StoredSubscription | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async findByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<StoredSubscription | null> {
    for (const row of this.rows.values()) {
      if (row.stripeSubscriptionId === stripeSubscriptionId) return { ...row };
    }
    return null;
  }

  async findDecidingForOffices(officeIds: readonly string[]): Promise<OfficeSubscriptionRow[]> {
    return [...this.rows.values()].flatMap((row) =>
      row.officeId !== null &&
      officeIds.includes(row.officeId) &&
      (isInEffect(row.status) || (row.status === 'LAPSED' && row.firstPaidAt !== null))
        ? [
            {
              officeId: row.officeId,
              status: row.status,
              lapsedAt: row.lapsedAt,
              firstPaidAt: row.firstPaidAt,
            },
          ]
        : [],
    );
  }

  async acquireSyncLease(
    id: string,
    token: string,
    now: Date,
    until: Date,
  ): Promise<StoredSubscription | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    if (row.syncLeaseUntil !== null && row.syncLeaseUntil.getTime() > now.getTime()) return null;
    row.syncLeaseToken = token;
    row.syncLeaseUntil = until;
    this.requested.delete(id); // a stale mark: this holder reads the provider afresh
    return { ...row };
  }

  async markSyncRequested(id: string, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.syncLeaseUntil === null || row.syncLeaseUntil.getTime() <= now.getTime()) {
      return false;
    }
    this.requested.add(id);
    return true;
  }

  async releaseSyncLease(id: string, token: string): Promise<void> {
    const row = this.rows.get(id);
    if (row && row.syncLeaseToken === token) {
      row.syncLeaseToken = null;
      row.syncLeaseUntil = null;
    }
  }

  async writeSync(id: string, token: string, patch: SyncPatch): Promise<SyncWriteResult> {
    const row = this.rows.get(id);
    if (!row || row.syncLeaseToken !== token) return { outcome: 'lease_lost', dirty: false };
    if (this.wouldDuplicate(row, patch.status))
      return { outcome: 'duplicate_in_effect', dirty: false };
    row.status = patch.status;
    row.stripeSubscriptionId = patch.stripeSubscriptionId;
    row.stripeCustomerId = patch.stripeCustomerId;
    row.cancelAtPeriodEnd = patch.cancelAtPeriodEnd;
    row.currentPeriodStart = patch.currentPeriodStart;
    row.currentPeriodEnd = patch.currentPeriodEnd;
    row.scheduledPlanId = patch.scheduledPlanId;
    row.scheduledChangeAt = patch.scheduledChangeAt;
    row.firstPaidAt = patch.firstPaidAt;
    if (patch.firstPaidAt !== null) row.firstPaymentFree = patch.firstPaymentFree;
    this.reconcileFailures.delete(id);
    row.lapsedAt = patch.lapsedAt;
    row.readOnlyAt = patch.readOnlyAt;
    row.lastSyncedAt = patch.lastSyncedAt;
    if (patch.plan !== null) {
      row.planId = patch.plan.id;
      row.planCode = patch.plan.code;
      row.activeJourneyLimit = patch.plan.activeJourneyLimit;
    }
    row.syncLeaseToken = null;
    row.syncLeaseUntil = null;
    if (patch.status === 'LAPSED') this.openKeys.delete(id);
    const dirty = this.requested.delete(id);
    return { outcome: 'written', dirty };
  }

  async attachOffice(id: string, officeId: string, now: Date): Promise<AttachOfficeOutcome> {
    const row = this.rows.get(id);
    if (!row || row.officeId !== null) return 'already_attached';
    const other = [...this.rows.values()].some(
      (candidate) =>
        candidate.id !== id && candidate.officeId === officeId && isInEffect(candidate.status),
    );
    if (other && isInEffect(row.status)) return 'duplicate_in_effect';
    row.officeId = officeId;
    row.provisionedAt = now;
    this.openKeys.delete(id); // the buyer's key is held until the office is attached
    return 'attached';
  }

  async findInEffectForOffice(
    officeId: string,
    exceptId: string,
  ): Promise<StoredSubscription | null> {
    for (const row of this.rows.values()) {
      if (row.id !== exceptId && row.officeId === officeId && isInEffect(row.status)) {
        return { ...row };
      }
    }
    return null;
  }

  async deleteAbandonedPending(checkoutSessionId: string): Promise<boolean> {
    for (const row of this.rows.values()) {
      if (
        row.checkoutSessionId === checkoutSessionId &&
        row.status === 'PENDING' &&
        row.stripeSubscriptionId === null
      ) {
        this.rows.delete(row.id);
        this.openKeys.delete(row.id);
        return true;
      }
    }
    return false;
  }

  async findOpenCheckout(key: string): Promise<StoredSubscription | null> {
    for (const [id, openKey] of this.openKeys) {
      if (openKey === key) return this.findById(id);
    }
    return null;
  }

  async setCheckoutSession(
    id: string,
    checkoutSessionId: string,
    stripeCustomerId: string,
  ): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'PENDING' || row.checkoutSessionId !== null) return false;
    row.checkoutSessionId = checkoutSessionId;
    row.stripeCustomerId = stripeCustomerId;
    return true;
  }

  async deletePendingById(id: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'PENDING' || row.stripeSubscriptionId !== null) return false;
    this.rows.delete(id);
    this.openKeys.delete(id);
    return true;
  }

  async findInEffectByOffice(officeId: string): Promise<StoredSubscription | null> {
    for (const row of this.rows.values()) {
      if (row.officeId === officeId && isInEffect(row.status)) return { ...row };
    }
    return null;
  }

  async findRecentForOffice(officeId: string, limit: number): Promise<StoredSubscription[]> {
    return [...this.rows.values()]
      .filter((row) => row.officeId === officeId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  async findCustomerIdOfOffice(officeId: string): Promise<string | null> {
    const withCustomer = [...this.rows.values()]
      .filter((row) => row.officeId === officeId && row.stripeCustomerId !== null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return withCustomer[0]?.stripeCustomerId ?? null;
  }

  async existsEarlierPaid(officeId: string, exceptId: string, before: Date): Promise<boolean> {
    return [...this.rows.values()].some(
      (row) =>
        row.officeId === officeId &&
        row.id !== exceptId &&
        row.firstPaidAt !== null &&
        !row.firstPaymentFree &&
        row.firstPaidAt.getTime() < before.getTime(),
    );
  }

  async claimRefund(id: string, now: Date, staleBefore: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || !isInEffect(row.status) || row.refundedAt !== null) return false;
    if (row.refundClaimedAt !== null && row.refundClaimedAt.getTime() > staleBefore.getTime()) {
      return false;
    }
    row.refundClaimedAt = now;
    if (row.refundRequestedAt === null || row.refundRequestedAt.getTime() > now.getTime()) {
      row.refundRequestedAt = now;
    }
    return true;
  }

  async releaseRefundClaim(id: string, claimedAt: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row?.refundClaimedAt?.getTime() === claimedAt.getTime()) row.refundClaimedAt = null;
  }

  async findRefundsToFinish(limit: number): Promise<StoredSubscription[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          isInEffect(row.status) && (row.refundedAt !== null || row.refundRequestedAt !== null),
      )
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  async findPendingWithSession(before: Date, limit: number): Promise<StoredSubscription[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.status === 'PENDING' &&
          row.stripeSubscriptionId === null &&
          row.checkoutSessionId !== null &&
          row.createdAt.getTime() < before.getTime(),
      )
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  async markReconcileFailed(id: string, now: Date): Promise<void> {
    this.reconcileFailures.set(id, now);
  }

  async findInEffectByBuyerWithoutOffice(buyerUserId: string): Promise<StoredSubscription | null> {
    for (const row of this.rows.values()) {
      if (row.buyerUserId === buyerUserId && row.officeId === null && isInEffect(row.status)) {
        return { ...row };
      }
    }
    return null;
  }

  async findCustomerIdOfBuyer(buyerUserId: string): Promise<string | null> {
    const withCustomer = [...this.rows.values()]
      .filter((row) => row.buyerUserId === buyerUserId && row.stripeCustomerId !== null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return withCustomer[0]?.stripeCustomerId ?? null;
  }

  async markRefunded(id: string, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.refundedAt !== null) return false;
    row.refundedAt = now;
    return true;
  }

  async findIdsToReconcile(args: {
    staleBefore: Date;
    lapsedSince: Date;
    limit: number;
  }): Promise<Array<{ id: string; status: StoredSubscription['status'] }>> {
    const syncedAt = (row: StoredSubscription) => row.lastSyncedAt?.getTime() ?? 0;
    const failedAt = (row: StoredSubscription) =>
      this.reconcileFailures.get(row.id)?.getTime() ?? 0;
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.stripeSubscriptionId !== null &&
          (row.lastSyncedAt === null || row.lastSyncedAt.getTime() < args.staleBefore.getTime()) &&
          (row.status !== 'LAPSED' ||
            (row.lapsedAt !== null && row.lapsedAt.getTime() >= args.lapsedSince.getTime())),
      )
      .sort((a, b) => failedAt(a) - failedAt(b) || syncedAt(a) - syncedAt(b))
      .slice(0, args.limit)
      .map((row) => ({ id: row.id, status: row.status }));
  }

  async purgeOrphanedPending(before: Date): Promise<number> {
    let purged = 0;
    for (const row of [...this.rows.values()]) {
      if (
        row.status === 'PENDING' &&
        row.stripeSubscriptionId === null &&
        row.checkoutSessionId === null &&
        row.createdAt.getTime() < before.getTime()
      ) {
        this.rows.delete(row.id);
        this.openKeys.delete(row.id);
        purged += 1;
      }
    }
    return purged;
  }

  /** BR-012-08: the unique index on one in-effect subscription per office. */
  private wouldDuplicate(row: StoredSubscription, status: StoredSubscription['status']): boolean {
    if (row.officeId === null || !isInEffect(status)) return false;
    return [...this.rows.values()].some(
      (other) => other.id !== row.id && other.officeId === row.officeId && isInEffect(other.status),
    );
  }
}
