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
// provider mutation carries an idempotency key derived from the FACTS that define the action, so a
// retry is the same call whatever webhook synced in between. Logs carry ids and codes only (SC-15).
//
// "A full refund of what it paid" (BR-012-29, DL-012-10) means EVERY paid invoice of the first
// subscription, each minus what was already refunded: the invoice that created it and an upgrade's
// proration paid inside the window, never just the latest invoice. Unpaid invoices are voided. If
// any refund cannot be confirmed, nothing is recorded and nothing is cancelled (the claim goes back).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService, type ConfigType } from '@nestjs/config';
import type { AccessContext, ActingOwner } from '../access/access-context.js';
import { Clock } from '../common/clock/clock.js';
import { DomainError } from '../common/errors/domain-error.js';
import { logSafeError } from '../common/errors/log-safe-error.js';
import { Decimal } from '../common/money/money.js';
import businessConfig from '../config/business.config.js';
import type { Env } from '../config/env.js';
import { CouponsService } from '../coupons/coupons.service.js';
import { type PageRequest, type Paginated, pageOfList } from '../common/pagination/paginated.js';
import {
  type PlanChangePreviewLine,
  PaymentGateway,
  type ProviderInvoice,
} from '../payments/payment-gateway.js';
import type { Plan, PlanInterval } from '../plans/plan.js';
import { PlansService } from '../plans/plans.service.js';
import { decideCancel, decideUndoCancel } from './domain/cancellation.js';
import {
  CHECKOUT_SESSION_MINUTES,
  classifyOpenCheckout,
  openCheckoutKey,
} from './domain/checkout-guard.js';
import { pickDisplayedSubscription } from './domain/displayed-subscription.js';
import { isReadOnly, readOnlyAtOf } from './domain/grace.js';
import { classifyPlanChange, type PlanChange } from './domain/plan-change.js';
import { judgeQuoteDate, quoteExpiresAt } from './domain/plan-quote.js';
import { planRefund } from './domain/refund-plan.js';
import { refundEligibleUntil } from './domain/refund-eligibility.js';
import { reconcileCutoffs } from './domain/reconcile-window.js';
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
import { TtlCache } from './ttl-cache.js';

/** A refund claim older than this is a caller that died before it refunded: it can be retaken. */
export const REFUND_CLAIM_STALE_MS = 5 * 60 * 1000;
/**
 * BR-012-11: how many of the newest invoices the billing history can page through. The provider
 * lists by cursor, so page numbers are cut from ONE bounded read (its maximum, 100) kept for
 * INVOICE_CACHE_MS: older invoices stay on the provider's own portal.
 */
export const BILLING_HISTORY_LIMIT = 100;
/** How many of an office's latest subscriptions the plan page chooses from. */
const RECENT_SUBSCRIPTIONS = 20;
const MINUTE_MS = 60 * 1000;
/** How long an office's invoice list is reused (invalidated by every action of ours). */
export const INVOICE_CACHE_MS = 30 * 1000;
/** How long an upgrade's preview is reused (the figure is the provider's, read a moment ago). */
export const PREVIEW_CACHE_MS = 10 * 1000;
/** Each in-memory provider cache holds at most this many entries (oldest dropped first). */
export const MAX_CACHED_ENTRIES = 500;

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
    readonly price: Decimal;
    readonly interval: PlanInterval;
    readonly at: Date | null;
  } | null;
  /** BR-012-17: choosing the plan in effect releases the scheduled change ("undo"). */
  readonly canUndoScheduledChange: boolean;
  /** BR-012-19: renewal was stopped and the paid period has not ended, so it can be undone. */
  readonly canUndoCancel: boolean;
  /**
   * What the next charge is, in reais: the scheduled plan's price when one is scheduled, else the
   * plan's own; null when nothing renews (cancelling, lapsed). Catalog prices: a coupon's discount
   * is not applied here.
   */
  readonly nextChargeAmount: Decimal | null;
  readonly lapsedAt: Date | null;
  /** BR-012-28: when the office turns read-only, from the stored lapse and today's setting. */
  readonly readOnlyAt: Date | null;
  /** BR-012-28: the office is read-only now (lapsed beyond the grace period), by the server's clock. */
  readonly readOnly: boolean;
  readonly firstPaidAt: Date | null;
  /** BR-012-29: until when cancelling refunds in full; null when it does not. */
  readonly refundEligibleUntil: Date | null;
  /** AR-43: the settings the page words (the refund window and the grace period, in days). */
  readonly refundWindowDays: number;
  readonly graceDays: number;
}

/**
 * BR-012-16: what the member is quoted for an upgrade. The proration date is pinned at preview time
 * and the change must send the quote back: the server re-asks the provider as of THAT date and
 * charges only if the amount is still the quoted one. Valid for QUOTE_TTL_MS from the pinned instant.
 */
export interface PlanChangeQuote {
  readonly planCode: string;
  readonly prorationDate: Date;
  readonly amountDue: Decimal;
  readonly currency: 'BRL';
  readonly nextChargeAt: Date | null;
  readonly expiresAt: Date;
}

/** What the member sends back to confirm a quote: only these facts are read, and none is trusted. */
export interface ConfirmedQuote {
  readonly planCode: string;
  readonly prorationDate: Date;
  readonly amountDue: Decimal;
  readonly nextChargeAt: Date | null;
}

/**
 * BR-012-16..BR-012-18: what choosing a plan would do, before the member confirms. `amountDue` is
 * what the provider would charge NOW (zero for anything but an upgrade).
 */
export interface PlanChangePreviewView {
  readonly change: PlanChange;
  readonly amountDue: Decimal;
  readonly currency: 'BRL';
  /** Signed reais: the new price charged and the credit for the unused time of the old one. */
  readonly lines: readonly PlanChangePreviewLine[];
  /** When a scheduled change starts; null for an upgrade (it starts once paid) and for no change. */
  readonly effectiveAt: Date | null;
  readonly nextChargeAt: Date | null;
  readonly nextChargeAmount: Decimal;
  /** An upgrade's quote, to be sent back with the change; null for everything else. */
  readonly quote: PlanChangeQuote | null;
}

/** The success page asks only this (BR-012-09): the redirect itself grants nothing. */
export type CheckoutState = 'PENDING' | 'CONFIRMED';

/** What asking the provider about an unconfirmed checkout came to (ADR-005). */
export type CheckoutRecovery = 'recovered' | 'removed' | 'waiting';

@Injectable()
export class SubscriptionsBillingService {
  private readonly logger = new Logger(SubscriptionsBillingService.name);
  /** The invoice list per provider customer, reused for INVOICE_CACHE_MS (one read per office). */
  private readonly invoiceCache = new TtlCache<ProviderInvoice[]>(MAX_CACHED_ENTRIES);
  /**
   * An upgrade's preview per subscription and plan, reused for PREVIEW_CACHE_MS: choosing a plan in
   * the dialog back and forth must not ask the provider each time. Dropped by every action of ours.
   */
  private readonly previewCache = new TtlCache<PlanChangePreviewView>(MAX_CACHED_ENTRIES);

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
    let record = await this.subscriptions.findById(ref);
    if (record === null || record.buyerUserId !== ctx.accountId) throw new DomainError('NOT_FOUND');
    // ADR-005: a buyer who paid while the provider's events never arrived is not left waiting for
    // the daily job: an old enough unconfirmed checkout asks the provider, here and now.
    const { sessionBefore } = reconcileCutoffs(this.clock.now());
    if (
      record.status === 'PENDING' &&
      record.stripeSubscriptionId === null &&
      record.checkoutSessionId !== null &&
      record.createdAt.getTime() < sessionBefore.getTime()
    ) {
      try {
        if ((await this.recoverPendingCheckout(record)) !== 'waiting') {
          record = await this.subscriptions.findById(ref);
        }
      } catch (error) {
        // The page answers PENDING; the daily job asks again.
        this.logger.warn(`Checkout ${ref} could not be checked: ${logSafeError(error)}`);
      }
    }
    // Confirmed means the provider confirmed it AND the office exists to manage it (BR-012-07).
    return record !== null && isInEffect(record.status) && record.officeId !== null
      ? 'CONFIRMED'
      : 'PENDING';
  }

  /**
   * BR-012-11: a page of the billing history, newest first, for any current member. The provider
   * lists by cursor, so the pages are cut from one bounded read (the newest BILLING_HISTORY_LIMIT)
   * reused for INVOICE_CACHE_MS; `total` counts that read. An office that never paid has none.
   * The provider being unreachable is BILLING_HISTORY_UNAVAILABLE: the plan page works without it.
   */
  async invoices(
    ctx: AccessContext,
    requestedOfficeId: string | undefined,
    page: PageRequest,
  ): Promise<Paginated<ProviderInvoice>> {
    const acting = this.officeOf(ctx, requestedOfficeId);
    const customerId = await this.subscriptions.findCustomerIdOfOffice(acting.owner.ownerId);
    if (customerId === null) return pageOfList<ProviderInvoice>([], page);
    return pageOfList(await this.invoiceListOf(customerId), page);
  }

  /**
   * ADR-005: asks the provider what became of a checkout that has a session and no subscription of
   * ours. A session the buyer PAID is read through the normal sync (office created, duplicates
   * resolved) even though no event ever arrived; an expired one leaves nothing; one still open
   * after 24 h is closed first (and read if the buyer paid it in that instant). A record whose
   * session is not CONFIRMED expired or unpaid is never removed: a provider error propagates and the
   * record stays.
   */
  async recoverPendingCheckout(record: StoredSubscription): Promise<CheckoutRecovery> {
    if (record.checkoutSessionId === null) return 'waiting';
    let session = await this.gateway.retrieveCheckoutSession(record.checkoutSessionId);
    if (
      session.state === 'open' &&
      record.createdAt.getTime() < reconcileCutoffs(this.clock.now()).openSessionBefore.getTime()
    ) {
      const closed = await this.gateway.expireCheckoutSession(record.checkoutSessionId);
      session = await this.gateway.retrieveCheckoutSession(record.checkoutSessionId);
      if (closed === 'expired' && session.state === 'open') {
        session = { state: 'expired', subscriptionId: null };
      }
    }
    if (session.state === 'complete' && session.subscriptionId !== null) {
      await this.sync.recoverCheckout(record.id, session.subscriptionId);
      return 'recovered';
    }
    if (session.state === 'expired') {
      await this.subscriptions.deletePendingById(record.id);
      return 'removed';
    }
    return 'waiting';
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
      // The guard above and the insert are not one step: a payment confirmed in between (a webhook
      // landing now) must not be followed by a second checkout. Looked at again, now that this
      // checkout is recorded, so a confirmation after this point finds the record and the
      // duplicate resolution (BR-012-08) takes over.
      await this.assertNothingInEffect(ctx.accountId, target.officeId);
      const customerId = target.customerId ?? (await this.customerOf(ctx.accountId, buyer));
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
      if (!(error instanceof DomainError)) {
        this.logger.warn(`Checkout ${pending.id} could not be started: ${logSafeError(error)}`);
      }
      if (sessionId !== null) await this.expireQuietly(sessionId);
      await this.subscriptions.deletePendingById(pending.id);
      // A refusal (the office got a subscription meanwhile) is the refusal; a fault is a failed checkout.
      if (error instanceof DomainError) throw error;
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
   *    after the sync below reads it (BR-012-16); an unpaid upgrade changes nothing here. The
   *    price is changed FIRST and a scheduled downgrade is released only after that succeeded, so
   *    a rejected upgrade does not lose the downgrade;
   *  - an EQUAL or LOWER limit is scheduled for the start of the next period (BR-012-17);
   *  - the journeys in progress do not matter (BR-012-18);
   *  - a subscriber may stay on a WITHDRAWN plan (BR-012-04) but not move to one, and the price it
   *    moves to must still be active at the provider;
   *  - a subscription that stops at the period end is not changed (undo the cancellation first);
   *  - the provider rejecting the change (e.g. a price it cannot switch to) is CHANGE_PLAN_FAILED.
   */
  async changePlan(
    ctx: AccessContext,
    input: { planCode: string; officeId?: string; quote?: ConfirmedQuote },
  ): Promise<OfficeSubscriptionView> {
    const { acting, subscription, target, change } = await this.resolveChange(ctx, input);
    if (change === 'keep') return this.viewOf(ctx, acting, subscription);
    // A subscription that stops at the period end has nothing to move to afterwards, and an
    // upgrade would be billed for a period that is ending: undo the cancellation first.
    if (subscription.cancelAtPeriodEnd) throw new DomainError('SUBSCRIPTION_NOT_CHANGEABLE');

    const subscriptionId = this.providerIdOf(subscription);
    // The key is made of the facts that define the action, not of when we last synced, so a retry
    // after an unrelated webhook is the same call and a later, different action is another.
    const key = [
      subscription.id,
      subscription.planId,
      target.id,
      subscription.currentPeriodStart?.getTime() ?? 0,
      subscription.scheduledPlanId ?? '-',
    ].join(':');
    try {
      if (change === 'release_schedule') {
        await this.gateway.releaseScheduledChange(subscriptionId, `release:${key}`);
      } else {
        // The price must still be sold at the provider (it may have been archived since).
        const price = await this.gateway.getPrice(target.stripePriceId);
        if (price === null || !price.active) throw new DomainError('INVALID_PLAN');
        if (change === 'upgrade') {
          // BR-012-16: charged only as the member was quoted, as of the quoted instant
          const prorationDate = await this.verifiedQuoteDate(subscription, target, input.quote);
          await this.gateway.changeSubscriptionPrice({
            subscriptionId,
            priceId: target.stripePriceId,
            prorationDate,
            idempotencyKey: `upgrade:${key}:${prorationDate.getTime()}`,
          });
          // Only now that the upgrade was accepted: a downgrade scheduled before it is moot.
          if (subscription.scheduledPlanId !== null) {
            await this.gateway.releaseScheduledChange(subscriptionId, `release:${key}`);
          }
        } else {
          await this.gateway.scheduleSubscriptionPrice({
            subscriptionId,
            priceId: target.stripePriceId,
            idempotencyKey: `schedule:${key}`,
          });
        }
      }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      this.logger.warn(`Plan change of ${subscription.id} failed: ${logSafeError(error)}`);
      throw new DomainError('CHANGE_PLAN_FAILED');
    }
    return this.viewOf(ctx, acting, await this.refreshed(subscription));
  }

  /**
   * The quote an upgrade is confirmed with, judged WITHOUT trusting what the client sent beyond
   * the pinned instant and the amount it saw: no quote, a quote of another plan, an instant that is
   * in the future, expired or outside the current period, or an amount (or next charge date) that
   * the provider, asked as of the SAME instant for the CURRENT state, no longer gives, is
   * QUOTE_STALE: nothing is charged and the member confirms the new quote. The client's own
   * `expiresAt` is never read; the expiry comes from the pinned instant.
   */
  private async verifiedQuoteDate(
    subscription: StoredSubscription,
    target: Plan,
    quote: ConfirmedQuote | undefined,
  ): Promise<Date> {
    const stale = () => new DomainError('QUOTE_STALE');
    if (quote === undefined || quote.planCode !== target.code) throw stale();
    const verdict = judgeQuoteDate({
      prorationDate: quote.prorationDate,
      now: this.clock.now(),
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    });
    if (verdict !== 'ok') throw stale();
    const current = await this.gateway.previewPlanChange({
      subscriptionId: this.providerIdOf(subscription),
      priceId: target.stripePriceId,
      prorationDate: quote.prorationDate,
    });
    const nextCharge = current.nextChargeAt ?? subscription.currentPeriodEnd;
    if (
      !current.amountDue.equals(quote.amountDue) ||
      (nextCharge?.getTime() ?? null) !== (quote.nextChargeAt?.getTime() ?? null)
    ) {
      this.previewCache.deleteByPrefix(`${subscription.id}:`);
      throw stale();
    }
    return quote.prorationDate;
  }

  /**
   * BR-012-16..BR-012-18: what choosing a plan would do, asked before confirming; read only, nothing
   * is created or changed here or at the provider. An UPGRADE shows the provider's own prorated
   * amount (its upcoming invoice, the same proration the change uses), so the figure is the one it
   * charges, give or take the seconds between the preview and the confirmation; a scheduled change
   * charges nothing now and names its date; choosing the plan in effect or the one already
   * scheduled changes nothing. The same refusals as `changePlan`.
   */
  async previewChange(
    ctx: AccessContext,
    input: { planCode: string; officeId?: string },
  ): Promise<PlanChangePreviewView> {
    const { subscription, target, change } = await this.resolveChange(ctx, input);
    const periodEnd = subscription.currentPeriodEnd;
    const none = new Decimal(0);
    if (change === 'keep' || change === 'release_schedule') {
      const current = await this.planOf(subscription.planId);
      return {
        change,
        amountDue: none,
        currency: 'BRL',
        lines: [],
        effectiveAt: null,
        nextChargeAt: periodEnd,
        nextChargeAmount: current.price,
        quote: null,
      };
    }
    if (subscription.cancelAtPeriodEnd) throw new DomainError('SUBSCRIPTION_NOT_CHANGEABLE');
    if (change === 'schedule') {
      return {
        change,
        amountDue: none,
        currency: 'BRL',
        lines: [],
        effectiveAt: periodEnd,
        nextChargeAt: periodEnd,
        nextChargeAmount: target.price,
        quote: null,
      };
    }
    const cacheKey = `${subscription.id}:${target.code}`;
    const now = this.clock.now().getTime();
    const cached = this.previewCache.get(cacheKey, now);
    if (cached !== undefined) return cached;
    try {
      const price = await this.gateway.getPrice(target.stripePriceId);
      if (price === null || !price.active) throw new DomainError('INVALID_PLAN');
      // pinned to whole seconds now: the change is confirmed with this instant (the quote)
      const prorationDate = new Date(Math.floor(now / 1000) * 1000);
      const preview = await this.gateway.previewPlanChange({
        subscriptionId: this.providerIdOf(subscription),
        priceId: target.stripePriceId,
        prorationDate,
      });
      const nextChargeAt = preview.nextChargeAt ?? periodEnd;
      const view: PlanChangePreviewView = {
        change,
        amountDue: preview.amountDue,
        currency: 'BRL',
        lines: preview.lines,
        effectiveAt: null,
        nextChargeAt,
        nextChargeAmount: target.price,
        quote: {
          planCode: target.code,
          prorationDate: preview.prorationDate,
          amountDue: preview.amountDue,
          currency: 'BRL',
          nextChargeAt,
          expiresAt: quoteExpiresAt(preview.prorationDate),
        },
      };
      this.previewCache.set(cacheKey, view, now, PREVIEW_CACHE_MS);
      return view;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      this.logger.warn(`Plan change preview of ${subscription.id} failed: ${logSafeError(error)}`);
      throw new DomainError('CHANGE_PREVIEW_FAILED');
    }
  }

  /** The checks `changePlan` and `previewChange` share: the office's subscription, the target, the kind of change. */
  private async resolveChange(ctx: AccessContext, input: { planCode: string; officeId?: string }) {
    this.assertOwnContext(ctx);
    const acting = this.officeOf(ctx, input.officeId);
    const subscription = await this.subscriptions.findInEffectByOffice(acting.owner.ownerId);
    if (subscription === null) throw new DomainError('SUBSCRIPTION_NOT_CHANGEABLE');

    const target = await this.plans.findByCode(input.planCode);
    if (target === null) throw new DomainError('INVALID_PLAN');
    if (target.id !== subscription.planId && target.status !== 'OFFERED') {
      throw new DomainError('INVALID_PLAN');
    }
    return { acting, subscription, target, change: classifyPlanChange(subscription, target) };
  }

  // ---- Cancelling -----------------------------------------------------------------------------

  /**
   * BR-012-19 / BR-012-29: cancels the office's subscription.
   *
   *  - the office's FIRST subscription, inside the refund window (judged at the instant the cancel
   *    was first accepted, and also when renewal was already stopped) and not yet refunded: a full
   *    refund of what it paid (see the header) and the subscription ends at once (LAPSED, the
   *    grace period starts);
   *  - anything else: renewal stops and the plan stays in effect to the end of the paid period
   *    (CANCELING); no part of a paid period is refunded;
   *  - cancelling what is already cancelling is a success that does nothing.
   *
   * Two members cancelling at once refund once: the refund is CLAIMED with one conditional update;
   * the member who does not hold the claim gets CANCEL_IN_PROGRESS (409), never a silent 200. A
   * failure before the refund is confirmed gives the claim back, so the retry starts at once; a
   * crash after the refund is repaired by the next cancel (or the reconcile job), which finds it
   * recorded and only finishes the cancel.
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
        // The same cancel retried (or after an unrelated webhook) is the same call; a cancel after
        // an undo, a minute later, is another.
        const stamp = `${subscription.id}:${subscription.planId}:${subscription.currentPeriodStart?.getTime() ?? 0}:${Math.floor(now.getTime() / MINUTE_MS)}`;
        // A downgrade scheduled for after the period has no meaning once the plan ends.
        if (subscription.scheduledPlanId !== null) {
          await this.gateway.releaseScheduledChange(subscriptionId, `release:cancel:${stamp}`);
        }
        await this.gateway.setCancelAtPeriodEnd({
          subscriptionId,
          cancel: true,
          idempotencyKey: `cancel:${stamp}`,
        });
        return this.viewOf(ctx, acting, await this.refreshed(subscription));
      }
      case 'refund_and_cancel':
        await this.completeRefund(subscription);
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

    const now = this.clock.now();
    const decision = decideUndoCancel(subscription, now);
    if (decision === 'not_changeable') throw new DomainError('SUBSCRIPTION_NOT_CHANGEABLE');
    if (decision === 'noop') return this.viewOf(ctx, acting, subscription);
    await this.gateway.setCancelAtPeriodEnd({
      subscriptionId: this.providerIdOf(subscription),
      cancel: false,
      idempotencyKey: `undo-cancel:${subscription.id}:${subscription.planId}:${subscription.currentPeriodStart?.getTime() ?? 0}:${Math.floor(now.getTime() / MINUTE_MS)}`,
    });
    return this.viewOf(ctx, acting, await this.refreshed(subscription));
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
    // SC-16 (fail closed): without the restricted configuration Stripe would use the account's
    // default portal, which may let a customer cancel or switch plan outside our rules
    // (BR-012-17, BR-012-19, BR-012-29). In production the feature is off until the owner sets it.
    if (
      configurationId === undefined &&
      this.env.get('NODE_ENV', { infer: true }) === 'production'
    ) {
      this.logger.warn(
        'The billing portal is off: STRIPE_BILLING_PORTAL_CONFIGURATION_ID is not set (SC-16)',
      );
      throw new DomainError('BILLING_PORTAL_FAILED');
    }
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
      await this.assertNothingInEffect(ctx.accountId, owner.ownerId);
      return {
        officeId: owner.ownerId,
        customerId: await this.subscriptions.findCustomerIdOfOffice(owner.ownerId),
      };
    }
    // BR-002-21: an admin has no client relationships and never becomes an office.
    if (ctx.isAdmin) throw new DomainError('FORBIDDEN');
    // BR-012-07: nobody pays for an office that cannot be created.
    if (!this.provisioner.available) throw new DomainError('OFFICE_CREATION_UNAVAILABLE');
    await this.assertNothingInEffect(ctx.accountId, undefined);
    return { customerId: null };
  }

  /**
   * BR-012-08, BR-012-07: nothing is in effect for the office, or, for a buyer without an office,
   * no first subscription of theirs is in effect (it is waiting for its office, and a second
   * payment would be a second office). Asked before the record is made AND after it, because a
   * payment confirmed in between is exactly the race.
   */
  private async assertNothingInEffect(
    buyerUserId: string,
    officeId: string | undefined,
  ): Promise<void> {
    const found =
      officeId === undefined
        ? await this.subscriptions.findInEffectByBuyerWithoutOffice(buyerUserId)
        : await this.subscriptions.findInEffectByOffice(officeId);
    if (found !== null) throw new DomainError('SUBSCRIPTION_ALREADY_ACTIVE');
  }

  /**
   * ONE provider customer per buyer: the one their earlier records carry, else the one the
   * provider already has for their account (our user id in its metadata), else a new one.
   */
  private async customerOf(accountId: string, buyer: CheckoutBuyer): Promise<string> {
    const stored = await this.subscriptions.findCustomerIdOfBuyer(accountId);
    if (stored !== null) return stored;
    try {
      const known = await this.gateway.findCustomerByUserId(accountId);
      if (known !== null) return known;
    } catch (error) {
      // The search is a convenience (it lags behind writes); a new customer is the fallback.
      this.logger.warn(`The customer search failed: ${logSafeError(error)}`);
    }
    return (
      await this.gateway.createCustomer({
        email: buyer.email,
        name: buyer.name,
        userId: accountId,
        idempotencyKey: `customer:${accountId}`,
      })
    ).id;
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

  /**
   * BR-012-29: the refund of what the subscription paid, then the cancel at once, then the sync
   * (LAPSED, the grace starts). Also what the reconcile job runs for a refund left half done.
   *
   *  - not claimed and the refund is recorded: only the cancel is missing (a crash between): finish;
   *  - not claimed and nothing is recorded: another actor holds a live claim, CANCEL_IN_PROGRESS;
   *  - claimed: refund every paid invoice (`refundPaidInvoices`); ANY failure before the refund is
   *    confirmed, `markRefunded` included, gives the claim back (the retry re-reads the provider
   *    and finds what is already refunded), and nothing is cancelled.
   */
  async completeRefund(subscription: StoredSubscription): Promise<void> {
    const subscriptionId = this.providerIdOf(subscription);
    const now = this.clock.now();
    const claimed = await this.subscriptions.claimRefund(
      subscription.id,
      now,
      new Date(now.getTime() - REFUND_CLAIM_STALE_MS),
    );
    if (claimed) {
      try {
        await this.refundPaidInvoices(subscription.id, subscriptionId);
        await this.subscriptions.markRefunded(subscription.id, this.clock.now());
      } catch (error) {
        await this.subscriptions.releaseRefundClaim(subscription.id, now);
        throw error;
      }
    } else {
      const current = await this.subscriptions.findById(subscription.id);
      if (current === null || !isInEffect(current.status)) return; // it ended meanwhile
      if (current.refundedAt === null) throw new DomainError('CANCEL_IN_PROGRESS');
    }
    await this.gateway.cancelSubscription(subscriptionId);
    await this.refreshed(subscription);
  }

  /**
   * BR-012-29, DL-012-10: gives back everything the subscription was paid. The provider's own
   * figures decide (paid and already refunded, per invoice): unpaid invoices are voided so they
   * cannot be paid later, and every paid invoice is refunded what remains, each with its own
   * stable key. A refund that returns less than the invoice paid is a failure, not a success.
   */
  private async refundPaidInvoices(ref: string, subscriptionId: string): Promise<void> {
    const plan = planRefund(await this.gateway.listSubscriptionInvoices(subscriptionId));
    for (const invoiceId of plan.voids) await this.gateway.voidInvoice(invoiceId);
    for (const step of plan.refunds) {
      const { refunded } = await this.gateway.refundInvoice({
        invoiceId: step.invoiceId,
        idempotencyKey: `refund:${ref}:${step.invoiceId}`,
      });
      if (refunded.lessThan(step.amount)) {
        throw new Error('A refund returned less than the invoice paid');
      }
    }
    this.logger.log(
      `Subscription ${ref}: ${plan.refunds.length} invoices refunded, ${plan.voids.length} voided (BR-012-29)`,
    );
  }

  /** Re-reads the provider after one of our actions; the cached invoice list is stale now. */
  private async refreshed(subscription: StoredSubscription): Promise<StoredSubscription> {
    if (subscription.stripeCustomerId !== null) {
      this.invoiceCache.delete(subscription.stripeCustomerId);
    }
    // what a change would charge moves with every action of ours (the period, the plan, the schedule)
    this.previewCache.deleteByPrefix(`${subscription.id}:`);
    return this.sync.refresh(subscription.id);
  }

  private async refundEligibleUntilOf(
    subscription: StoredSubscription,
    now: Date,
  ): Promise<Date | null> {
    if (!isInEffect(subscription.status) || subscription.firstPaidAt === null) return null;
    // The right of withdrawal is judged when the member FIRST asked: a retry after the window of a
    // request made inside it completes (the claim was only released because something failed).
    const asOf = subscription.refundRequestedAt ?? now;
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
      asOf,
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
    const [plan, scheduled, inProgress, eligibleUntil] = await Promise.all([
      this.planOf(subscription.planId),
      subscription.scheduledPlanId === null ? null : this.planOf(subscription.scheduledPlanId),
      this.slots.inProgress(ctx, { actingOwner: acting }),
      this.refundEligibleUntilOf(subscription, now),
    ]);
    const inEffect = isInEffect(subscription.status);
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
              price: scheduled.price,
              interval: scheduled.interval,
              at: subscription.scheduledChangeAt,
            },
      canUndoScheduledChange: inEffect && scheduled !== null,
      canUndoCancel: decideUndoCancel(subscription, now) === 'undo',
      nextChargeAmount:
        !inEffect || subscription.cancelAtPeriodEnd ? null : (scheduled ?? plan).price,
      lapsedAt: subscription.lapsedAt,
      readOnlyAt:
        subscription.lapsedAt === null
          ? null
          : readOnlyAtOf(subscription.lapsedAt, this.config.subscriptions.graceDays),
      readOnly:
        subscription.status === 'LAPSED' &&
        subscription.lapsedAt !== null &&
        isReadOnly(subscription.lapsedAt, now, this.config.subscriptions.graceDays),
      firstPaidAt: subscription.firstPaidAt,
      refundEligibleUntil: eligibleUntil,
      refundWindowDays: this.config.subscriptions.refundWindowDays,
      graceDays: this.config.subscriptions.graceDays,
    };
  }

  /**
   * BR-012-11: the newest invoices of a customer, reused for INVOICE_CACHE_MS (the plan page is
   * reloaded often and every read is a provider call); any action of ours drops it.
   */
  private async invoiceListOf(customerId: string): Promise<ProviderInvoice[]> {
    const now = this.clock.now().getTime();
    const cached = this.invoiceCache.get(customerId, now);
    if (cached !== undefined) return cached;
    try {
      const invoices = await this.gateway.listInvoices(customerId, BILLING_HISTORY_LIMIT);
      this.invoiceCache.set(customerId, invoices, now, INVOICE_CACHE_MS);
      return invoices;
    } catch (error) {
      this.logger.warn(`The billing history could not be read: ${logSafeError(error)}`);
      throw new DomainError('BILLING_HISTORY_UNAVAILABLE');
    }
  }
}
