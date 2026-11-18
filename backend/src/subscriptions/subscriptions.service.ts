// SPEC-012 BR-012-07..BR-012-14, SC-11, ADR-005: the webhook. The provider is the source of truth
// for a subscription, so no event carries state we trust. An event says "something changed for
// this subscription"; `syncFromProvider` then
//
//   1. resolves our record (by the provider id, else by the ref we put on the checkout),
//   2. takes a per-record LEASE (one conditional update; losers answer WEBHOOK_BUSY, 503, and the
//      provider retries),
//   3. re-reads the subscription from the provider INSIDE the lease,
//   4. writes the state that snapshot maps to, conditional on still holding the lease.
//
// The lease serialises concurrent syncs, so a stale read can never overwrite a newer one; reading
// inside it makes the stored state always the provider's latest, whatever order the events came in
// (BR-012-13). The event ledger makes a delivery repeated after success a no-op and one repeated
// after a crash a re-run (the sync is idempotent). Logs carry ids and counts only (SC-15).
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Clock } from '../common/clock/clock.js';
import { DomainError } from '../common/errors/domain-error.js';
import { logSafeError } from '../common/errors/log-safe-error.js';
import businessConfig from '../config/business.config.js';
import {
  PaymentGateway,
  type PaymentEvent,
  type ProviderSubscription,
  WebhookSignatureError,
} from '../payments/payment-gateway.js';
import type { Plan } from '../plans/plan.js';
import { PlansService } from '../plans/plans.service.js';
import { isLaterSubscription } from './domain/duplicate.js';
import { isInEffect } from './domain/subscription-status.js';
import { type PlanFacts, reconcile, type ReconcileInput } from './domain/provider-state.js';
import { PaymentEventsRepository } from './payment-events.repository.js';
import { OFFICE_PROVISIONER, type OfficeProvisioner } from './ports/office-provisioner.js';
import {
  PAYMENT_FAILED_NOTIFIER,
  type PaymentFailedNotifier,
} from './ports/payment-failed.notifier.js';
import type { StoredSubscription } from './stored-subscription.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

/** BR-012-13: how long a sync may hold a subscription's lease before another can take it. */
export const SYNC_LEASE_MS = 30_000;

/** A delivery that finds the lease taken tries to take it this many times (ADR-005). */
const MAX_ACQUIRE_ATTEMPTS = 3;
/** A holder reads the provider again, while deliveries keep asking, at most this many times. */
const MAX_RESYNC_LOOPS = 3;
/** Duplicate resolution syncs other records inside a sync; this bounds that nesting. */
const MAX_NESTING = 3;

/**
 * What a sync of one provider subscription came to:
 *  - synced: our record equals the provider's snapshot read by this call (or by the holder that
 *    took over); `record` is what is stored afterwards;
 *  - covered: another delivery holds the lease and has been asked to read the provider once more
 *    after this event, so this event's information is read by it (no delay, no 503);
 *  - ignored: no record of ours owns the subscription (a legacy user-level one).
 */
type SyncResult =
  { kind: 'synced'; record: StoredSubscription } | { kind: 'covered' } | { kind: 'ignored' };

type LeasedPass = { kind: 'written'; dirty: boolean } | { kind: 'resolved'; result: SyncResult };

function factsOf(plan: Plan): PlanFacts {
  return { id: plan.id, code: plan.code, activeJourneyLimit: plan.activeJourneyLimit };
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly subscriptions: SubscriptionsRepository,
    private readonly events: PaymentEventsRepository,
    private readonly plans: PlansService,
    // AR-10: the payment provider through its port.
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock, // AR-24
    @Inject(OFFICE_PROVISIONER) private readonly provisioner: OfficeProvisioner,
    @Inject(PAYMENT_FAILED_NOTIFIER) private readonly notifier: PaymentFailedNotifier,
    // AR-43: the grace period is a setting.
    @Inject(businessConfig.KEY) private readonly config: ConfigType<typeof businessConfig>,
  ) {}

  /**
   * SC-11: verifies the signature over the raw body, then handles the event. Throws
   * INVALID_WEBHOOK_SIGNATURE for a body that does not verify, and only for that: a failure to
   * map a verified event is a fault of ours (5xx, the provider retries), logged by code only.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: PaymentEvent;
    try {
      event = this.gateway.parseWebhookEvent(rawBody, signature);
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        this.logger.error(`Webhook signature verification failed: ${logSafeError(error)}`);
        throw new DomainError('INVALID_WEBHOOK_SIGNATURE');
      }
      this.logger.error(`Webhook event could not be mapped: ${logSafeError(error)}`);
      throw error;
    }
    await this.handleProviderEvent(event);
  }

  /**
   * BR-012-13 / SC-11: handles one verified event, idempotently.
   *
   *  - first delivery: recorded, handled, marked processed;
   *  - repeated after it was handled: acknowledged, nothing else;
   *  - repeated after a crash or a fault midway (never marked processed): handled again.
   *
   * It throws when the event could not be handled in full (WEBHOOK_BUSY, a provider fault), which
   * answers 5xx, so the provider delivers it again.
   */
  async handleProviderEvent(event: PaymentEvent): Promise<void> {
    if (event.type === 'unhandled') {
      this.logger.log(`Unhandled event type: ${event.providerType}`);
      return;
    }
    const recording = await this.events.record(event.id, event.type, this.clock.now());
    if (recording === 'processed') return;

    await this.handle(event);
    await this.events.markProcessed(event.id, this.clock.now());
  }

  private async handle(event: Exclude<PaymentEvent, { type: 'unhandled' }>): Promise<void> {
    switch (event.type) {
      case 'checkout.completed': {
        if (event.subscriptionId === null || event.subscriptionRef === null) {
          this.ignoreLegacy(event.type);
          return;
        }
        // BR-012-09: the checkout redirect grants nothing; this confirmation, re-read from the
        // provider, is what makes the subscription real.
        await this.syncFromProvider(event.subscriptionId, event.subscriptionRef);
        return;
      }
      case 'subscription.changed':
        await this.syncFromProvider(event.subscriptionId);
        return;
      case 'invoice.paid': {
        // An invoice of something that is not a subscription says nothing about one.
        if (event.subscriptionId === null) return;
        await this.syncFromProvider(event.subscriptionId);
        return;
      }
      case 'invoice.payment_failed': {
        if (event.subscriptionId === null) return;
        const synced = await this.syncFromProvider(event.subscriptionId);
        // The email is decided from the state THIS delivery read. When a holder covers the event
        // instead, that read is not ours to act on: the provider delivers the event again, and
        // the retry (almost always uncontended) reads the state and tells the office.
        if (synced.kind === 'covered') throw new DomainError('WEBHOOK_BUSY');
        // BR-012-20: the provider's retry state, not the event, decides that the renewal failed.
        if (synced.kind === 'synced' && synced.record.status === 'PAST_DUE') {
          await this.notifyPaymentFailed(event.id, synced.record);
        }
        return;
      }
      case 'checkout.expired': {
        // Acceptance: an abandoned checkout leaves no office and no subscription in effect. Only
        // the PENDING record of THIS checkout session, with no provider subscription, is removed.
        const removed = await this.subscriptions.deleteAbandonedPending(event.checkoutSessionId);
        this.logger.log(`Abandoned checkout cleaned up: ${removed ? 1 : 0} pending subscription`);
        return;
      }
    }
  }

  /** The production keys carry placeholder Stripe values: no real user-level subscriber exists. */
  private ignoreLegacy(type: string): void {
    this.logger.warn(`Legacy user-level payment event ignored: ${type}`);
  }

  /**
   * BR-012-13: makes our record equal to the provider's current subscription.
   *
   * Syncs of one subscription are serialised by a lease, and a delivery that finds the lease taken
   * does not fail: it asks the holder, with one conditional update, to read the provider once more
   * AFTER this event, and is done (`covered`). The holder's write releases the lease atomically
   * and reports whether such a request arrived; if so it syncs again (at most MAX_RESYNC_LOOPS
   * times, then WEBHOOK_BUSY). A request that arrives after the release matches nothing, and its
   * sender takes the lease itself. So a burst is coalesced into reads that all happen after the
   * last event, with no delayed 503; only a lease that stays taken through MAX_ACQUIRE_ATTEMPTS
   * answers WEBHOOK_BUSY.
   *
   * `hintRef` is where the checkout event says our record is. It only helps to find the record;
   * the state written is always the provider's snapshot, read inside the lease.
   */
  private async syncFromProvider(
    stripeSubscriptionId: string,
    hintRef?: string,
    depth = 0,
  ): Promise<SyncResult> {
    if (depth > MAX_NESTING) throw new Error('Subscription sync nested too deeply');
    const local = await this.resolveLocal(stripeSubscriptionId, hintRef);
    if (local === null) {
      this.ignoreLegacy('subscription');
      return { kind: 'ignored' };
    }

    for (let loop = 0; loop < MAX_RESYNC_LOOPS; loop += 1) {
      const lease = await this.takeLease(local.id);
      if (lease === null) {
        // First pass: a holder was asked to read after our event. Later pass: another delivery
        // took the lease after our write and reads after it. Either way nothing is left to do.
        if (loop === 0) return { kind: 'covered' };
        return { kind: 'synced', record: await this.reload(local.id) };
      }
      const pass = await this.syncUnderLease(lease, stripeSubscriptionId, depth);
      if (pass.kind === 'resolved') return pass.result;
      if (!pass.dirty) {
        return {
          kind: 'synced',
          record: await this.ensureOffice(await this.reload(local.id), depth),
        };
      }
    }
    throw new DomainError('WEBHOOK_BUSY');
  }

  /**
   * Takes the record's lease, or asks its holder to read again (null: covered). Gives up with
   * WEBHOOK_BUSY only when the lease stays taken yet no request can be left on it.
   */
  private async takeLease(
    id: string,
  ): Promise<{ record: StoredSubscription; token: string } | null> {
    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
      const token = randomUUID();
      const leasedAt = this.clock.now();
      const record = await this.subscriptions.acquireSyncLease(
        id,
        token,
        leasedAt,
        new Date(leasedAt.getTime() + SYNC_LEASE_MS),
      );
      if (record !== null) return { record, token };
      // A request matches only while a lease is live; a lease just released matches nothing and
      // the next attempt takes it.
      if (await this.subscriptions.markSyncRequested(id, this.clock.now())) return null;
    }
    throw new DomainError('WEBHOOK_BUSY');
  }

  /** One read of the provider and one write, inside the lease taken by `takeLease`. */
  private async syncUnderLease(
    lease: { record: StoredSubscription; token: string },
    stripeSubscriptionId: string,
    depth: number,
  ): Promise<LeasedPass> {
    const { record: leased, token } = lease;
    let leaseHeld = true;
    try {
      // The retrieve is INSIDE the lease: syncs of one subscription are strictly ordered, so each
      // read is newer than the write before it.
      const provider = await this.gateway.retrieveSubscription(stripeSubscriptionId);
      if (!this.belongsTo(leased, provider)) {
        // A paid subscription that does not match its record is never acknowledged as nothing.
        this.logger.warn(`Provider subscription does not belong to subscription ${leased.id}`);
        throw new Error('A provider subscription does not belong to the record it names');
      }
      const patch = reconcile(await this.reconcileInput(leased, provider));
      const result = await this.subscriptions.writeSync(leased.id, token, patch);
      if (result.outcome === 'duplicate_in_effect') {
        // Nothing was written, so the lease is still ours: give it back before touching others.
        await this.subscriptions.releaseSyncLease(leased.id, token);
        leaseHeld = false;
        return {
          kind: 'resolved',
          result: await this.resolveDuplicate({
            incoming: leased,
            officeId: leased.officeId ?? '',
            incomingProviderId: provider.id,
            incomingFirstPaidAt: patch.firstPaidAt,
            retry: () => this.syncFromProvider(provider.id, leased.id, depth + 1),
            depth,
          }),
        };
      }
      // 'written' released the lease with the write; 'lease_lost' means it is another sync's now.
      leaseHeld = false;
      if (result.outcome === 'lease_lost') throw new DomainError('WEBHOOK_BUSY');
      return { kind: 'written', dirty: result.dirty };
    } finally {
      if (leaseHeld) await this.subscriptions.releaseSyncLease(leased.id, token);
    }
  }

  private async reload(id: string): Promise<StoredSubscription> {
    const record = await this.subscriptions.findById(id);
    if (record === null) throw new Error('A subscription disappeared during its sync');
    return record;
  }

  /**
   * By the provider id; else by the ref in the event; else by the ref the provider's own
   * subscription carries. No ref anywhere means a legacy user-level subscription (null). A ref
   * that names no record is NOT legacy: a subscription we created has no record, which is a
   * fault (5xx, retried and reported), never an acknowledgement.
   */
  private async resolveLocal(
    stripeSubscriptionId: string,
    hintRef: string | undefined,
  ): Promise<StoredSubscription | null> {
    const byProviderId = await this.subscriptions.findByStripeSubscriptionId(stripeSubscriptionId);
    if (byProviderId !== null) return byProviderId;
    if (hintRef !== undefined) {
      const byHint = await this.subscriptions.findById(hintRef);
      if (byHint !== null) return byHint;
      this.logger.warn(`A checkout names subscription ${hintRef}, which does not exist`);
      throw new Error('A checkout names a subscription record that does not exist');
    }
    // An event that arrives before `checkout.session.completed` has neither: the provider's own
    // subscription carries the ref we gave it at checkout. This read only finds the record.
    const provider = await this.gateway.retrieveSubscription(stripeSubscriptionId);
    if (provider.subscriptionRef === null) return null;
    const byRef = await this.subscriptions.findById(provider.subscriptionRef);
    if (byRef === null) {
      this.logger.warn(
        `Provider subscription ${provider.id} names subscription ${provider.subscriptionRef}, which does not exist`,
      );
      throw new Error('A provider subscription names a record that does not exist');
    }
    return byRef;
  }

  /**
   * A record owns one provider subscription, and the provider's ref names the record. Before the
   * record has a provider id the ref MUST match: nothing else proves whose subscription it is.
   */
  private belongsTo(record: StoredSubscription, provider: ProviderSubscription): boolean {
    if (record.stripeSubscriptionId === null) return provider.subscriptionRef === record.id;
    if (record.stripeSubscriptionId !== provider.id) return false;
    return provider.subscriptionRef === null || provider.subscriptionRef === record.id;
  }

  /**
   * BR-012-04 / BR-012-16: the plan changes only when the provider bills another price than the
   * plan the record is on (withdrawn plans included); a price no plan maps to changes neither the
   * plan nor the limit, except on the first activation, which it refuses: an office must not be
   * activated on a plan we cannot name.
   */
  private async reconcileInput(
    record: StoredSubscription,
    provider: ProviderSubscription,
  ): Promise<ReconcileInput> {
    const current = await this.plans.findById(record.planId);
    let paidPlan: PlanFacts | null = null;
    if (current === null || current.stripePriceId !== provider.priceId) {
      const billed = await this.plans.findByStripePriceId(provider.priceId);
      if (billed === null) {
        this.logger.warn(`Provider price ${provider.priceId} maps to no plan (${record.id})`);
        if (record.stripeSubscriptionId === null) {
          throw new Error('The provider price maps to no plan: the first activation is refused');
        }
      } else {
        paidPlan = factsOf(billed);
      }
    }

    let scheduledPlan: PlanFacts | null = null;
    if (provider.scheduledPriceId !== null) {
      const scheduled = await this.plans.findByStripePriceId(provider.scheduledPriceId);
      if (scheduled === null) {
        this.logger.warn(
          `Scheduled provider price ${provider.scheduledPriceId} maps to no plan (${record.id})`,
        );
      } else {
        scheduledPlan = factsOf(scheduled);
      }
    }

    return {
      current: record,
      provider,
      paidPlan,
      scheduledPlan,
      now: this.clock.now(),
      graceDays: this.config.subscriptions.graceDays,
    };
  }

  /**
   * BR-012-08: the incoming subscription would be a second one in effect for its office (two
   * checkouts both paid, or a lapsed one paid again). The unique index only says that they
   * collide, not which is right, so the provider decides:
   *
   *  1. read the conflicting subscription again from the provider, under its own lease: if it is
   *     no longer in effect, it was stale, becomes LAPSED, and `retry` runs the incoming write
   *     again (nothing is cancelled);
   *  2. if both are in effect at the provider, the LATER one (by first payment, else by
   *     creation) is cancelled at the provider and synced to LAPSED: an older, paid subscription
   *     is never cancelled in favour of a late arrival, whatever order the index race had.
   *
   * The cancel is idempotent. The warning names ids only; the money collected for the cancelled
   * one is refunded by hand.
   */
  private async resolveDuplicate(args: {
    incoming: StoredSubscription;
    officeId: string;
    incomingProviderId: string;
    incomingFirstPaidAt: Date | null;
    retry: () => Promise<SyncResult>;
    depth: number;
  }): Promise<SyncResult> {
    const { incoming, officeId, incomingProviderId, retry, depth } = args;
    const conflicting = await this.subscriptions.findInEffectForOffice(officeId, incoming.id);
    if (conflicting === null) return retry(); // it lapsed meanwhile

    if (conflicting.stripeSubscriptionId !== null) {
      const reread = await this.syncFromProvider(
        conflicting.stripeSubscriptionId,
        conflicting.id,
        depth + 1,
      );
      // Another delivery is reading it right now: what is stored may still be stale, so nothing is
      // cancelled on it. The provider delivers this event again.
      if (reread.kind === 'covered') throw new DomainError('WEBHOOK_BUSY');
    }
    const current = await this.subscriptions.findById(conflicting.id);
    if (current === null || !isInEffect(current.status)) return retry(); // it was stale

    const incomingIsLater = isLaterSubscription(
      { id: incoming.id, firstPaidAt: args.incomingFirstPaidAt },
      { id: current.id, firstPaidAt: current.firstPaidAt },
    );
    const cancelled = incomingIsLater ? incoming.id : current.id;
    const kept = incomingIsLater ? current.id : incoming.id;
    const cancelledProviderId = incomingIsLater ? incomingProviderId : current.stripeSubscriptionId;
    if (cancelledProviderId === null) {
      throw new Error('A duplicate subscription has no provider subscription to cancel');
    }
    this.logger.warn(
      `Subscription ${cancelled} duplicates ${kept}, both in effect at the provider: cancelling ${cancelled}; refund by hand`,
    );
    await this.gateway.cancelSubscription(cancelledProviderId);
    const resynced = await this.syncFromProvider(cancelledProviderId, cancelled, depth + 1);
    return incomingIsLater ? resynced : retry();
  }

  /**
   * BR-012-07: a first subscription that is in effect and has no office yet gets one, through the
   * SPEC-011 port. The port is idempotent by the subscription ref and the attach is conditional
   * on none attached, so two deliveries racing end with one office per subscription ref. (One
   * office per buyer is the port's contract and the billing PR's one-pending-checkout guard.)
   */
  private async ensureOffice(
    record: StoredSubscription,
    depth: number,
  ): Promise<StoredSubscription> {
    if (record.officeId !== null || !isInEffect(record.status)) return record;
    const { officeId } = await this.provisioner.createForFirstPayment({
      subscriptionRef: record.id,
      accountId: record.buyerUserId,
    });
    const attach = () => this.subscriptions.attachOffice(record.id, officeId, this.clock.now());
    const outcome = await attach();
    if (outcome === 'duplicate_in_effect' && record.stripeSubscriptionId !== null) {
      const result = await this.resolveDuplicate({
        incoming: record,
        officeId,
        incomingProviderId: record.stripeSubscriptionId,
        incomingFirstPaidAt: record.firstPaidAt,
        retry: async () => {
          if ((await attach()) === 'duplicate_in_effect') {
            throw new Error('An office keeps another subscription in effect');
          }
          return { kind: 'synced', record: await this.reload(record.id) };
        },
        depth,
      });
      return result.kind === 'synced' ? result.record : record;
    }
    // Losing the race to attach reads the winner's office.
    const stored = await this.reload(record.id);
    if (outcome === 'already_attached' && stored.officeId !== officeId) {
      // The port returned another office than the one kept: it is not idempotent by ref, or it
      // answers per buyer. The kept office is the first attached; ids only.
      this.logger.warn(
        `Subscription ${record.id} keeps office ${stored.officeId ?? 'none'}; the provisioner returned ${officeId}`,
      );
    }
    return stored;
  }

  /**
   * BR-012-20: tells the office its renewal payment failed, once per event. The claim comes
   * before the send, so a replay of the event sends nothing; a send that failed gives the claim
   * back and the error, so the provider's retry sends it.
   */
  private async notifyPaymentFailed(eventId: string, record: StoredSubscription): Promise<void> {
    // A first payment that fails never reaches PAST_DUE (it stays pending): no office, no one.
    if (record.officeId === null) return;
    if (!(await this.events.claimEmail(eventId, this.clock.now()))) return;
    try {
      await this.notifier.notifyPaymentFailed(record.officeId);
    } catch (error) {
      await this.events.releaseEmailClaim(eventId);
      throw error;
    }
  }
}
