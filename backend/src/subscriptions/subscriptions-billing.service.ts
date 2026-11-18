// SPEC-012 BR-012-06..BR-012-11, BR-012-16..BR-012-19, BR-012-29: what a member of an office does
// with its plan. The office is ALWAYS the one `AccessContext.resolveActingOwner` chooses among the
// offices the caller is a CURRENT member of (AR-13, BR-002-11): never an id from a path, and a
// non-member gets the same NOT_FOUND as a missing office (AR-14). Any member may manage the plan
// (BR-012-11), and also while the office is read-only or lapsed (BR-012-28): nothing here asks for
// a writable office.
//
// The provider is the source of truth (ADR-005). Every operation below ASKS the provider for the
// change, then re-reads its subscription through the same lease-and-dirty-mark sync the webhook
// uses (`SubscriptionsService.refresh`). Nothing writes a status, a plan or a limit locally, so an
// upgrade reaches the limit only once the provider reports the new paid price (BR-012-16). Every
// provider mutation carries an idempotency key. Logs carry ids and codes only (SC-15).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService, type ConfigType } from '@nestjs/config';
import type { AccessContext, ActingOwner } from '../access/access-context.js';
import { Clock } from '../common/clock/clock.js';
import { DomainError } from '../common/errors/domain-error.js';
import { logSafeError } from '../common/errors/log-safe-error.js';
import type { Decimal } from '../common/money/money.js';
import businessConfig from '../config/business.config.js';
import type { Env } from '../config/env.js';
import { CouponsService } from '../coupons/coupons.service.js';
import { PaymentGateway, type ProviderInvoice } from '../payments/payment-gateway.js';
import type { Plan, PlanInterval } from '../plans/plan.js';
import { PlansService } from '../plans/plans.service.js';
import { decideCancel, decideUndoCancel } from './domain/cancellation.js';
import {
  CHECKOUT_SESSION_MINUTES,
  classifyOpenCheckout,
  openCheckoutKey,
} from './domain/checkout-guard.js';
import { pickDisplayedSubscription } from './domain/displayed-subscription.js';
import { readOnlyAtOf } from './domain/grace.js';
import { classifyPlanChange } from './domain/plan-change.js';
import { refundEligibleUntil } from './domain/refund-eligibility.js';
import {
  effectiveJourneyLimit,
  isInEffect,
  type SubscriptionStatus,
} from './domain/subscription-status.js';
import { JourneySlotsService } from './journey-slots.service.js';
import { OFFICE_PROVISIONER, type OfficeProvisioner } from './ports/office-provisioner.js';
import type { StoredSubscription } from './stored-subscription.js';
import { OpenCheckoutExistsError, SubscriptionsRepository } from './subscriptions.repository.js';
import { SubscriptionsService } from './subscriptions.service.js';

/** A refund claim older than this is a caller that died before it refunded: it can be retaken. */
export const REFUND_CLAIM_STALE_MS = 5 * 60 * 1000;
/** BR-012-11: how many invoices the plan page lists. */
export const BILLING_HISTORY_LIMIT = 24;
/** How many of an office's latest subscriptions the plan page chooses from. */
const RECENT_SUBSCRIPTIONS = 20;

/** The account that starts a checkout, as the provider's customer is named (SC-15: sent, not logged). */
export interface CheckoutBuyer {
  readonly email: string;
  readonly name: string;
}

export interface CheckoutInput {
  readonly planCode: string;
  readonly couponCode?: string;
  /** Which office, for a member of several (BR-002-11); absent for an account with none. */
  readonly officeId?: string;
}

/** BR-012-11, BR-012-26: what the office's plan page shows. */
export interface OfficeSubscriptionView {
  readonly officeId: string;
  readonly plan: {
    readonly code: string;
    readonly name: string;
    readonly price: Decimal;
    readonly interval: PlanInterval;
  };
  readonly status: SubscriptionStatus;
  /** BR-012-21: the limit in effect now (0 once lapsed). */
  readonly activeJourneyLimit: number;
  /** BR-012-26: journeys in progress, against the limit. */
  readonly inProgress: number;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  /** BR-012-17: the downgrade scheduled for the next period, with its date. */
  readonly scheduledChange: {
    readonly planCode: string;
    readonly planName: string;
    readonly activeJourneyLimit: number;
    readonly at: Date | null;
  } | null;
  readonly lapsedAt: Date | null;
  /** BR-012-28: when the office turns read-only, from the stored lapse and today's setting. */
  readonly readOnlyAt: Date | null;
  readonly firstPaidAt: Date | null;
  /** BR-012-29: until when cancelling refunds in full; null when it does not. */
  readonly refundEligibleUntil: Date | null;
  /** BR-012-11: the billing history; null when the provider could not be read just now. */
  readonly invoices: readonly ProviderInvoice[] | null;
}

/** The success page asks only this (BR-012-09): the redirect itself grants nothing. */
export type CheckoutState = 'PENDING' | 'CONFIRMED';

@Injectable()
export class SubscriptionsBillingService {
  private readonly logger = new Logger(SubscriptionsBillingService.name);

  constructor(
    private readonly subscriptions: SubscriptionsRepository,
    private readonly sync: SubscriptionsService,
    private readonly plans: PlansService,
    private readonly coupons: CouponsService,
    private readonly slots: JourneySlotsService,
    // AR-10: the payment provider through its port.
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock, // AR-24
    @Inject(OFFICE_PROVISIONER) private readonly provisioner: OfficeProvisioner,
    // AR-43: the grace period and the refund window are settings.
    @Inject(businessConfig.KEY) private readonly config: ConfigType<typeof businessConfig>,
    private readonly env: ConfigService<Env, true>,
  ) {}

  // ---- Reading --------------------------------------------------------------------------------

  /** BR-012-11: any current member sees the plan, the next charge and the billing history. */
  async view(ctx: AccessContext, requestedOfficeId?: string): Promise<OfficeSubscriptionView> {
    const acting = this.officeOf(ctx, requestedOfficeId);
    return this.viewOf(ctx, acting, await this.displayedFor(acting.owner.ownerId));
  }

  /**
   * BR-012-09: the success page asks whether the payment was confirmed. Authorised by the buyer
   * (`buyerUserId` is the caller), never by an owner id, so the ref in the path proves nothing:
   * another account's ref is the same NOT_FOUND as one that does not exist (AR-14).
   */
  async checkoutState(ctx: AccessContext, ref: string): Promise<CheckoutState> {
    const record = await this.subscriptions.findById(ref);
    if (record === null || record.buyerUserId !== ctx.accountId) throw new DomainError('NOT_FOUND');
    // Confirmed means the provider confirmed it AND the office exists to manage it (BR-012-07).
    return isInEffect(record.status) && record.officeId !== null ? 'CONFIRMED' : 'PENDING';
  }

  // ---- Checkout -------------------------------------------------------------------------------

  /**
   * BR-012-10: starts the provider's hosted Checkout and answers its URL. The subscription is
   * PENDING and grants nothing until the provider confirms payment (BR-012-09).
   *
   *  - an account with offices checks out for ONE of them, which must have nothing in effect
   *    (BR-012-08); an account with none creates its office when the first payment is confirmed
   *    (BR-012-07), only if SPEC-011 can create it, so nobody pays for an office that cannot
   *    exist; an admin has no client relationships and is refused (BR-002-21);
   *  - ONE open checkout per office, or per buyer while there is no office: a still-open session
   *    of an earlier attempt is expired and replaced, unless it was paid (CHECKOUT_IN_PROGRESS).
   *    The database holds it unique, so two requests at once cannot both start one;
   *  - a failure at any step leaves nothing behind (acceptance: an abandoned checkout leaves no
   *    office and no subscription in effect).
   */
  async checkout(
    ctx: AccessContext,
    buyer: CheckoutBuyer,
    input: CheckoutInput,
  ): Promise<{ url: string }> {
    this.assertOwnContext(ctx);
    // BR-012-04: only an offered plan can be subscribed to.
    const plan = await this.plans.findByCode(input.planCode);
    if (plan === null || plan.status !== 'OFFERED') throw new DomainError('INVALID_PLAN');
    // BR-026-08: a coupon applies to a NEW subscription, here and only here.
    const promotionCodeId = await this.promotionCodeOf(input.couponCode);

    const target = await this.checkoutTarget(ctx, input.officeId);
    const key = openCheckoutKey({
      buyerUserId: ctx.accountId,
      ...(target.officeId === undefined ? {} : { officeId: target.officeId }),
    });
    await this.releaseReplaceableCheckout(key);

    let pending: StoredSubscription;
    try {
      pending = await this.subscriptions.createPending({
        buyerUserId: ctx.accountId,
        planId: plan.id,
        planCode: plan.code,
        activeJourneyLimit: plan.activeJourneyLimit,
        openCheckoutKey: key,
        ...(target.officeId === undefined ? {} : { officeId: target.officeId }),
      });
    } catch (error) {
      // Two requests at once: the other one holds the key.
      if (error instanceof OpenCheckoutExistsError) throw new DomainError('CHECKOUT_IN_PROGRESS');
      throw error;
    }

    let sessionId: string | null = null;
    try {
      const customerId =
        target.customerId ??
        (
          await this.gateway.createCustomer({
            email: buyer.email,
            name: buyer.name,
            userId: ctx.accountId,
            idempotencyKey: `customer:${pending.id}`,
          })
        ).id;
      const frontendUrl = this.env.get('FRONTEND_URL', { infer: true });
      const session = await this.gateway.createOfficeCheckout({
        customerId,
        priceId: plan.stripePriceId,
        subscriptionRef: pending.id,
        successUrl: `${frontendUrl}/plans/success?ref=${pending.id}`,
        cancelUrl: `${frontendUrl}/plans/cancel`,
        expiresAt: new Date(this.clock.now().getTime() + CHECKOUT_SESSION_MINUTES * 60_000),
        idempotencyKey: `checkout:${pending.id}`,
        ...(promotionCodeId === null ? {} : { promotionCodeId }),
      });
      sessionId = session.sessionId;
      // ADR-005: stored at once, so `checkout.session.expired` finds this record.
      if (!(await this.subscriptions.setCheckoutSession(pending.id, sessionId, customerId))) {
        throw new Error('The checkout record disappeared before its session was stored');
      }
      return { url: session.url };
    } catch (error) {
      this.logger.warn(`Checkout ${pending.id} could not be started: ${logSafeError(error)}`);
      if (sessionId !== null) await this.expireQuietly(sessionId);
      await this.subscriptions.deletePendingById(pending.id);
      throw new DomainError('CHECKOUT_SESSION_FAILED');
    }
  }

  // ---- Changing the plan ----------------------------------------------------------------------

  /**
   * BR-012-16..BR-012-18: moves a subscription in effect to another offered plan (or back to the
   * one it is on, which drops a scheduled downgrade).
   *
   *  - a HIGHER limit is an upgrade now: the provider invoices the prorated difference and changes
   *    the price only once it is paid. Our record, limit included, follows the provider's price
   *    after the sync below reads it (BR-012-16); an unpaid upgrade changes nothing here;
   *  - an EQUAL or LOWER limit is scheduled for the start of the next period (BR-012-17);
   *  - the journeys in progress do not matter (BR-012-18);
   *  - a subscriber may stay on a WITHDRAWN plan (BR-012-04) but not move to one.
   */
  async changePlan(
    ctx: AccessContext,
    input: { planCode: string; officeId?: string },
  ): Promise<OfficeSubscriptionView> {
    this.assertOwnContext(ctx);
    const acting = this.officeOf(ctx, input.officeId);
    const subscription = await this.subscriptions.findInEffectByOffice(acting.owner.ownerId);
    if (subscription === null) throw new DomainError('SUBSCRIPTION_NOT_CHANGEABLE');

    const target = await this.plans.findByCode(input.planCode);
    if (target === null) throw new DomainError('INVALID_PLAN');
    if (target.id !== subscription.planId && target.status !== 'OFFERED') {
      throw new DomainError('INVALID_PLAN');
    }

    const change = classifyPlanChange(subscription, target);
    const subscriptionId = this.providerIdOf(subscription);
    // The key follows the state we last synced, so a retry of the same request is the same call
    // and a later, different change is not mistaken for it.
    const key = `${subscription.id}:${target.id}:${subscription.lastSyncedAt?.getTime() ?? 0}`;
    switch (change) {
      case 'keep':
        return this.viewOf(ctx, acting, subscription);
      case 'release_schedule':
        await this.gateway.releaseScheduledChange(subscriptionId, `release:${key}`);
        break;
      case 'upgrade':
        // A pending downgrade would fight the upgrade: drop it first (the schedule owns the
        // subscription's items while it exists).
        if (subscription.scheduledPlanId !== null) {
          await this.gateway.releaseScheduledChange(subscriptionId, `release:${key}`);
        }
        await this.gateway.changeSubscriptionPrice({
          subscriptionId,
          priceId: target.stripePriceId,
          idempotencyKey: `upgrade:${key}`,
        });
        break;
      case 'schedule':
        // A subscription that stops at the period end has nothing to move to afterwards.
        if (subscription.cancelAtPeriodEnd) throw new DomainError('SUBSCRIPTION_NOT_CHANGEABLE');
        await this.gateway.scheduleSubscriptionPrice({
          subscriptionId,
          priceId: target.stripePriceId,
          idempotencyKey: `schedule:${key}`,
        });
        break;
    }
    return this.viewOf(ctx, acting, await this.sync.refresh(subscription.id));
  }

  // ---- Cancelling -----------------------------------------------------------------------------

  /**
   * BR-012-19 / BR-012-29: cancels the office's subscription.
   *
   *  - the office's FIRST subscription, inside the refund window and not yet refunded: a full
   *    refund and the subscription ends at once (LAPSED, the grace period starts);
   *  - anything else: renewal stops and the plan stays in effect to the end of the paid period
   *    (CANCELING); no part of a paid period is refunded;
   *  - cancelling what is already cancelling is a success that does nothing.
   *
   * Two members cancelling at once refund once: the refund is CLAIMED with one conditional update
   * (a claim that is not followed by a refund within 5 minutes can be retaken), and the provider
   * deduplicates the refund by a stable key. A crash between the refund and the cancel is
   * repaired by the next cancel, which finds the refund recorded and finishes the cancel.
   */
  async cancel(ctx: AccessContext, requestedOfficeId?: string): Promise<OfficeSubscriptionView> {
    this.assertOwnContext(ctx);
    const acting = this.officeOf(ctx, requestedOfficeId);
    const subscription = await this.subscriptions.findInEffectByOffice(acting.owner.ownerId);
    if (subscription === null) throw new DomainError('SUBSCRIPTION_NOT_CANCELABLE');

    const now = this.clock.now();
    const decision = decideCancel({
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      refundEligible: (await this.refundEligibleUntilOf(subscription, now)) !== null,
      refunded: subscription.refundedAt !== null,
    });
    switch (decision) {
      case 'not_cancelable':
        throw new DomainError('SUBSCRIPTION_NOT_CANCELABLE');
      case 'noop':
        return this.viewOf(ctx, acting, subscription);
      case 'cancel_at_period_end': {
        const subscriptionId = this.providerIdOf(subscription);
        const stamp = `${subscription.id}:${subscription.lastSyncedAt?.getTime() ?? 0}`;
        // A downgrade scheduled for after the period has no meaning once the plan ends.
        if (subscription.scheduledPlanId !== null) {
          await this.gateway.releaseScheduledChange(subscriptionId, `release:cancel:${stamp}`);
        }
        await this.gateway.setCancelAtPeriodEnd({
          subscriptionId,
          cancel: true,
          idempotencyKey: `cancel:${stamp}`,
        });
        return this.viewOf(ctx, acting, await this.sync.refresh(subscription.id));
      }
      case 'refund_and_cancel':
        await this.refundAndCancel(subscription, now);
        return this.viewOf(ctx, acting, await this.displayedFor(acting.owner.ownerId));
    }
  }

  /** BR-012-19: a member undoes the cancellation before the paid period ends. */
  async undoCancel(
    ctx: AccessContext,
    requestedOfficeId?: string,
  ): Promise<OfficeSubscriptionView> {
    this.assertOwnContext(ctx);
    const acting = this.officeOf(ctx, requestedOfficeId);
    const subscription = await this.subscriptions.findInEffectByOffice(acting.owner.ownerId);
    if (subscription === null) throw new DomainError('SUBSCRIPTION_NOT_CHANGEABLE');

    const decision = decideUndoCancel(subscription, this.clock.now());
    if (decision === 'not_changeable') throw new DomainError('SUBSCRIPTION_NOT_CHANGEABLE');
    if (decision === 'noop') return this.viewOf(ctx, acting, subscription);
    await this.gateway.setCancelAtPeriodEnd({
      subscriptionId: this.providerIdOf(subscription),
      cancel: false,
      idempotencyKey: `undo-cancel:${subscription.id}:${subscription.lastSyncedAt?.getTime() ?? 0}`,
    });
    return this.viewOf(ctx, acting, await this.sync.refresh(subscription.id));
  }

  // ---- Payment method -------------------------------------------------------------------------

  /**
   * BR-012-10, BR-012-17: the provider's page to update the payment method and see invoices
   * (restricted to those two in the provider's portal configuration). Works for a lapsed office
   * too: paying again starts with a valid card.
   */
  async billingPortal(ctx: AccessContext, requestedOfficeId?: string): Promise<{ url: string }> {
    this.assertOwnContext(ctx);
    const acting = this.officeOf(ctx, requestedOfficeId);
    const customerId = await this.subscriptions.findCustomerIdOfOffice(acting.owner.ownerId);
    if (customerId === null) throw new DomainError('SUBSCRIPTION_NOT_FOUND');
    const configurationId = this.env.get('STRIPE_BILLING_PORTAL_CONFIGURATION_ID', {
      infer: true,
    });
    try {
      return await this.gateway.createBillingPortalSession({
        customerId,
        returnUrl: `${this.env.get('FRONTEND_URL', { infer: true })}/office/plan`,
        ...(configurationId === undefined ? {} : { configurationId }),
      });
    } catch (error) {
      this.logger.warn(`The billing portal could not be opened: ${logSafeError(error)}`);
      throw new DomainError('BILLING_PORTAL_FAILED');
    }
  }

  // ---- Internals ------------------------------------------------------------------------------

  /** AR-13, BR-002-11: the office the caller manages, among its CURRENT memberships. */
  private officeOf(ctx: AccessContext, requestedOfficeId: string | undefined): ActingOwner {
    const acting = ctx.resolveActingOwner(requestedOfficeId);
    // A self-advised account is not an office: it has no plan to manage (BR-012-27).
    if (acting.owner.ownerType !== 'office') throw new DomainError('FORBIDDEN');
    return acting;
  }

  /** A read-only context (a support grant's view) never changes a plan. */
  private assertOwnContext(ctx: AccessContext): void {
    if (ctx.readOnly) throw new DomainError('FORBIDDEN');
  }

  /**
   * Which office a checkout is for, and the customer to reuse. An account with offices must name
   * (or have only) one with nothing in effect; an account with none is a first subscription.
   */
  private async checkoutTarget(
    ctx: AccessContext,
    requestedOfficeId: string | undefined,
  ): Promise<{ officeId?: string; customerId: string | null }> {
    if (ctx.memberships.length > 0 || requestedOfficeId !== undefined) {
      const { owner } = this.officeOf(ctx, requestedOfficeId);
      if ((await this.subscriptions.findInEffectByOffice(owner.ownerId)) !== null) {
        throw new DomainError('SUBSCRIPTION_ALREADY_ACTIVE');
      }
      return {
        officeId: owner.ownerId,
        customerId: await this.subscriptions.findCustomerIdOfOffice(owner.ownerId),
      };
    }
    // BR-002-21: an admin has no client relationships and never becomes an office.
    if (ctx.isAdmin) throw new DomainError('FORBIDDEN');
    // BR-012-07: nobody pays for an office that cannot be created.
    if (!this.provisioner.available) throw new DomainError('OFFICE_CREATION_UNAVAILABLE');
    return { customerId: null };
  }

  private async promotionCodeOf(couponCode: string | undefined): Promise<string | null> {
    if (couponCode === undefined) return null;
    const coupon = await this.coupons.validateCoupon(couponCode);
    if (coupon.stripePromotionCodeId === null) throw new DomainError('COUPON_INVALID');
    return coupon.stripePromotionCodeId;
  }

  /**
   * BR-012-07, BR-012-08: an earlier open checkout of the same office or buyer is replaced when
   * nothing was paid, and refused (CHECKOUT_IN_PROGRESS) while payment is under way.
   */
  private async releaseReplaceableCheckout(key: string): Promise<void> {
    const open = await this.subscriptions.findOpenCheckout(key);
    if (open === null) return;
    const verdict = classifyOpenCheckout(open, this.clock.now());
    if (verdict.state === 'in_flight') throw new DomainError('CHECKOUT_IN_PROGRESS');
    if (verdict.state === 'replaceable') {
      // The buyer may be paying it right now: then it is theirs to finish.
      const outcome = await this.gateway.expireCheckoutSession(verdict.checkoutSessionId);
      if (outcome === 'completed') throw new DomainError('CHECKOUT_IN_PROGRESS');
    }
    await this.subscriptions.deletePendingById(open.id);
  }

  private async expireQuietly(sessionId: string): Promise<void> {
    try {
      await this.gateway.expireCheckoutSession(sessionId);
    } catch (error) {
      // The session ends by itself within CHECKOUT_SESSION_MINUTES.
      this.logger.warn(`A checkout session could not be expired: ${logSafeError(error)}`);
    }
  }

  /** BR-012-29: the refund, then the cancel at once, then the sync (LAPSED, the grace starts). */
  private async refundAndCancel(subscription: StoredSubscription, now: Date): Promise<void> {
    const subscriptionId = this.providerIdOf(subscription);
    const claimed = await this.subscriptions.claimRefund(
      subscription.id,
      now,
      new Date(now.getTime() - REFUND_CLAIM_STALE_MS),
    );
    if (claimed) {
      await this.gateway.refundLatestPayment({
        subscriptionId,
        idempotencyKey: `refund:${subscription.id}`,
      });
      await this.subscriptions.markRefunded(subscription.id, this.clock.now());
      this.logger.log(`Subscription ${subscription.id} refunded in full (BR-012-29)`);
    } else {
      // Someone else holds the claim, or the refund was made and only the cancel is missing (a
      // crash between the two): finish the cancel in the second case, leave the first alone.
      const current = await this.subscriptions.findById(subscription.id);
      if (current === null || current.refundedAt === null || !isInEffect(current.status)) return;
    }
    await this.gateway.cancelSubscription(subscriptionId);
    await this.sync.refresh(subscription.id);
  }

  private async refundEligibleUntilOf(
    subscription: StoredSubscription,
    now: Date,
  ): Promise<Date | null> {
    if (!isInEffect(subscription.status) || subscription.firstPaidAt === null) return null;
    return refundEligibleUntil(
      {
        firstPaidAt: subscription.firstPaidAt,
        refundedAt: subscription.refundedAt,
        earlierPaidSubscription: await this.subscriptions.existsEarlierPaid(
          subscription.officeId ?? '',
          subscription.id,
          subscription.firstPaidAt,
        ),
      },
      now,
      this.config.subscriptions.refundWindowDays,
    );
  }

  /** The subscription the plan page shows: in effect, else the latest paid lapse (BR-012-28). */
  private async displayedFor(officeId: string): Promise<StoredSubscription> {
    const recent = await this.subscriptions.findRecentForOffice(officeId, RECENT_SUBSCRIPTIONS);
    const displayed = pickDisplayedSubscription(recent);
    if (displayed === null) throw new DomainError('SUBSCRIPTION_NOT_FOUND');
    return displayed;
  }

  private providerIdOf(subscription: StoredSubscription): string {
    // A subscription in effect was read from the provider, so it has one: anything else is a fault.
    if (subscription.stripeSubscriptionId === null) {
      throw new Error('A subscription in effect has no provider subscription');
    }
    return subscription.stripeSubscriptionId;
  }

  private async planOf(planId: string): Promise<Plan> {
    const plan = await this.plans.findById(planId);
    // Plans are never deleted (BR-012-04): a subscription whose plan is gone is a fault.
    if (plan === null) throw new Error('A subscription names a plan that does not exist');
    return plan;
  }

  private async viewOf(
    ctx: AccessContext,
    acting: ActingOwner,
    subscription: StoredSubscription,
  ): Promise<OfficeSubscriptionView> {
    const now = this.clock.now();
    const [plan, scheduled, inProgress, eligibleUntil, invoices] = await Promise.all([
      this.planOf(subscription.planId),
      subscription.scheduledPlanId === null ? null : this.planOf(subscription.scheduledPlanId),
      this.slots.inProgress(ctx, { actingOwner: acting }),
      this.refundEligibleUntilOf(subscription, now),
      this.invoicesOf(subscription),
    ]);
    return {
      officeId: acting.owner.ownerId,
      plan: { code: plan.code, name: plan.name, price: plan.price, interval: plan.interval },
      status: subscription.status,
      activeJourneyLimit: effectiveJourneyLimit(subscription),
      inProgress,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      scheduledChange:
        scheduled === null
          ? null
          : {
              planCode: scheduled.code,
              planName: scheduled.name,
              activeJourneyLimit: scheduled.activeJourneyLimit,
              at: subscription.scheduledChangeAt,
            },
      lapsedAt: subscription.lapsedAt,
      readOnlyAt:
        subscription.lapsedAt === null
          ? null
          : readOnlyAtOf(subscription.lapsedAt, this.config.subscriptions.graceDays),
      firstPaidAt: subscription.firstPaidAt,
      refundEligibleUntil: eligibleUntil,
      invoices,
    };
  }

  /** BR-012-11: the billing history, or null when the provider cannot be read just now. */
  private async invoicesOf(subscription: StoredSubscription): Promise<ProviderInvoice[] | null> {
    if (subscription.stripeCustomerId === null) return [];
    try {
      return await this.gateway.listInvoices(subscription.stripeCustomerId, BILLING_HISTORY_LIMIT);
    } catch (error) {
      // The plan page works without the history; the interface says it is unavailable.
      this.logger.warn(`The billing history could not be read: ${logSafeError(error)}`);
      return null;
    }
  }
}
