import { isInEffect } from '../../src/subscriptions/domain/subscription-status.js';
import type { SyncPatch } from '../../src/subscriptions/domain/provider-state.js';
import type {
  AttachOfficeOutcome,
  OfficeSubscriptionRow,
  SubscriptionsRepository,
  SyncWriteResult,
} from '../../src/subscriptions/subscriptions.repository.js';
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
  private sequence = 0;

  /** The stored subscription, for assertions. */
  get(id: string): StoredSubscription {
    const row = this.rows.get(id);
    if (!row) throw new Error(`no subscription ${id}`);
    return { ...row };
  }

  async createPending(input: NewPendingSubscription): Promise<StoredSubscription> {
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
      lapsedAt: null,
      readOnlyAt: null,
      provisionedAt: null,
      refundClaimedAt: null,
      refundedAt: null,
      syncLeaseToken: null,
      syncLeaseUntil: null,
      lastSyncedAt: null,
    };
    this.rows.set(id, row);
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
        return true;
      }
    }
    return false;
  }

  /** BR-012-08: the unique index on one in-effect subscription per office. */
  private wouldDuplicate(row: StoredSubscription, status: StoredSubscription['status']): boolean {
    if (row.officeId === null || !isInEffect(status)) return false;
    return [...this.rows.values()].some(
      (other) => other.id !== row.id && other.officeId === row.officeId && isInEffect(other.status),
    );
  }
}
