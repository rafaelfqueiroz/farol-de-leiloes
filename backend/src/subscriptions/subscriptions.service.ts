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
} from '../payments/payment-gateway.js';
import type { Plan } from '../plans/plan.js';
import { PlansService } from '../plans/plans.service.js';
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
   * INVALID_WEBHOOK_SIGNATURE for a body that does not verify.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: PaymentEvent;
    try {
      event = this.gateway.parseWebhookEvent(rawBody, signature);
    } catch (error) {
      this.logger.error(`Webhook signature verification failed: ${logSafeError(error)}`);
      throw new DomainError('INVALID_WEBHOOK_SIGNATURE');
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
        // BR-012-20: the provider's retry state, not the event, decides that the renewal failed.
        if (synced !== null && synced.status === 'PAST_DUE') {
          await this.notifyPaymentFailed(event.id, synced);
        }
        return;
      }
      case 'checkout.expired': {
        if (event.subscriptionRef === null) {
          this.ignoreLegacy(event.type);
          return;
        }
        // Acceptance: an abandoned checkout leaves no office and no subscription in effect.
        const removed = await this.subscriptions.deleteAbandonedPending(event.subscriptionRef);
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
   * BR-012-13: makes our record equal to the provider's current subscription. Returns the record
   * as stored afterwards, or null when no record of ours owns the subscription (a legacy
   * user-level one: acknowledged and ignored).
   *
   * `hintRef` is where the checkout event says our record is. It only helps to find the record;
   * the state written is always the provider's snapshot, read inside the lease.
   */
  private async syncFromProvider(
    stripeSubscriptionId: string,
    hintRef?: string,
    duplicateRetry = false,
  ): Promise<StoredSubscription | null> {
    const local = await this.resolveLocal(stripeSubscriptionId, hintRef);
    if (local === null) {
      this.ignoreLegacy('subscription');
      return null;
    }

    const token = randomUUID();
    const leasedAt = this.clock.now();
    const leased = await this.subscriptions.acquireSyncLease(
      local.id,
      token,
      leasedAt,
      new Date(leasedAt.getTime() + SYNC_LEASE_MS),
    );
    // Another sync of this subscription is running: the provider delivers the event again.
    if (leased === null) throw new DomainError('WEBHOOK_BUSY');

    let leaseHeld = true;
    try {
      // The retrieve is INSIDE the lease: syncs of one subscription are strictly ordered, so each
      // read is newer than the write before it.
      const provider = await this.gateway.retrieveSubscription(stripeSubscriptionId);
      if (!this.belongsTo(leased, provider)) {
        this.logger.warn(`Provider subscription does not belong to subscription ${leased.id}`);
        return null;
      }
      const patch = reconcile(await this.reconcileInput(leased, provider));
      const outcome = await this.subscriptions.writeSync(leased.id, token, patch);
      if (outcome === 'duplicate_in_effect') {
        // Nothing was written, so the lease is still ours: give it back before syncing again.
        await this.subscriptions.releaseSyncLease(leased.id, token);
        leaseHeld = false;
        return await this.cancelDuplicate(leased, provider.id, duplicateRetry);
      }
      // 'written' released the lease with the write; 'lease_lost' means it is another sync's now.
      leaseHeld = false;
      if (outcome === 'lease_lost') throw new DomainError('WEBHOOK_BUSY');
    } finally {
      if (leaseHeld) await this.subscriptions.releaseSyncLease(leased.id, token);
    }

    const stored = await this.subscriptions.findById(leased.id);
    return stored === null ? null : this.ensureOffice(stored);
  }

  /** By the provider id; else by the ref in the event; else by the ref the provider holds. */
  private async resolveLocal(
    stripeSubscriptionId: string,
    hintRef: string | undefined,
  ): Promise<StoredSubscription | null> {
    const byProviderId = await this.subscriptions.findByStripeSubscriptionId(stripeSubscriptionId);
    if (byProviderId !== null) return byProviderId;
    if (hintRef !== undefined) {
      const byHint = await this.subscriptions.findById(hintRef);
      if (byHint !== null) return byHint;
    }
    // An event that arrives before `checkout.session.completed` has neither: the provider's own
    // subscription carries the ref we gave it at checkout. This read only finds the record.
    const provider = await this.gateway.retrieveSubscription(stripeSubscriptionId);
    return provider.subscriptionRef === null
      ? null
      : this.subscriptions.findById(provider.subscriptionRef);
  }

  /** A record owns one provider subscription, and the provider's ref (when set) names the record. */
  private belongsTo(record: StoredSubscription, provider: ProviderSubscription): boolean {
    if (record.stripeSubscriptionId !== null && record.stripeSubscriptionId !== provider.id) {
      return false;
    }
    return provider.subscriptionRef === null || provider.subscriptionRef === record.id;
  }

  /**
   * BR-012-04 / BR-012-16: the plan changes only when the provider bills another price than the
   * plan the record is on (withdrawn plans included); a price no plan maps to changes nothing.
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
   * BR-012-08: this subscription would be a second one in effect for its office (two checkouts
   * both paid). Never two in effect: the later one is cancelled at the provider at once, and the
   * sync runs again, so the provider's `canceled` is what is stored (LAPSED, in the usual way).
   * The money collected for it is refunded by hand: the warning is the operator's signal.
   */
  private async cancelDuplicate(
    record: StoredSubscription,
    providerSubscriptionId: string,
    alreadyRetried: boolean,
  ): Promise<StoredSubscription | null> {
    // The provider did not end it: stop here rather than loop (a fault, so someone looks).
    if (alreadyRetried) throw new Error('A duplicate subscription could not be cancelled');
    this.logger.warn(
      `Subscription ${record.id} duplicates an office subscription in effect: cancelling it at the provider; refund by hand`,
    );
    await this.gateway.cancelSubscription(providerSubscriptionId);
    return this.syncFromProvider(providerSubscriptionId, record.id, true);
  }

  /**
   * BR-012-07: a first subscription that is in effect and has no office yet gets one, through the
   * SPEC-011 port. The port is idempotent by the subscription ref and the attach is conditional
   * on none attached, so two deliveries racing end with one office and one subscription.
   */
  private async ensureOffice(record: StoredSubscription): Promise<StoredSubscription> {
    if (record.officeId !== null || !isInEffect(record.status)) return record;
    const { officeId } = await this.provisioner.createForFirstPayment({
      subscriptionRef: record.id,
      accountId: record.buyerUserId,
    });
    const outcome = await this.subscriptions.attachOffice(record.id, officeId, this.clock.now());
    if (outcome === 'duplicate_in_effect' && record.stripeSubscriptionId !== null) {
      return (await this.cancelDuplicate(record, record.stripeSubscriptionId, false)) ?? record;
    }
    // Losing the race to attach reads the winner's office (the same one, by idempotency).
    return (await this.subscriptions.findById(record.id)) ?? record;
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
