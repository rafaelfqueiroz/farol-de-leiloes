// SPEC-012 (ADR-005): the safety net under the webhook. Stripe retries a failed delivery for about
// 3 days and then gives up, and a holder that died after acknowledging a covered event leaves its
// information unread, so a record can stay behind the provider until some later event. Once a day
// this, under ONE run-level lock (two replicas do not both run it):
//
//   1. finishes refunds left half done ("refunded but still active", a claim whose holder died);
//   2. asks the provider about checkouts that have a session and no subscription of ours: a buyer
//      who PAID while the events never arrived is recovered through the normal sync (the office is
//      created, duplicates are resolved), an expired session is removed, and a record whose session
//      is not confirmed expired or unpaid is never removed (a provider error keeps it);
//   3. re-reads, through `SubscriptionsService.refresh` (the webhook's own lease and dirty-mark
//      path), every subscription that is not lapsed (and those lapsed in the last 14 days) last
//      synced more than 12 hours ago, a record the job cannot read sorting after the others so it
//      cannot starve the batch;
//   4. removes the checkouts whose creation never finished (no session id) after 3 days.
//
// It relies on the provider's dunning ENDING in a cancel, a required provider setting (ARCHITECTURE
// §13, runbook). AR-03: idempotent and safe to re-run; every run is recorded (success or failure) in
// jobexecutions. AR-04: switched off by SUBSCRIPTIONS_RECONCILE_ENABLED. AR-25: the cron states its
// zone. SC-15: the logs carry counts and stable codes only.
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BRASILIA_TIME_ZONE } from '../common/clock/brasilia-time.js';
import { Clock } from '../common/clock/clock.js';
import { DomainError } from '../common/errors/domain-error.js';
import { RunMode } from '../common/job-execution.js';
import { InJobContext } from '../common/observability/job-context.js';
import { jobErrorCode } from '../common/services/job-error-code.js';
import { JobExecutionService } from '../common/services/job-execution.service.js';
import schedulerConfig, { type SchedulerConfig } from '../config/scheduler.config.js';
import { reconcileCutoffs } from './domain/reconcile-window.js';
import { PaymentEventsRepository } from './payment-events.repository.js';
import { SubscriptionsBillingService } from './subscriptions-billing.service.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';
import { SubscriptionsService } from './subscriptions.service.js';

export const SUBSCRIPTIONS_RECONCILE_JOB = 'subscriptions-reconcile';

/** Bounds one run: the oldest syncs first; the rest are read tomorrow (or by their next event). */
export const RECONCILE_BATCH_SIZE = 200;
/** Bounds the refunds and the unconfirmed checkouts one run looks at. */
export const RECONCILE_SIDE_BATCH_SIZE = 50;

/**
 * The run-level lock: a claim on a document of the event ledger (token and expiry, one conditional
 * update), so two replicas do not both run the job. It never gets a `processedAt`, so it is
 * claimable again as soon as it is released or expires.
 */
export const RECONCILE_LOCK_ID = 'job:subscriptions-reconcile';
export const RECONCILE_LOCK_MS = 2 * 60 * 60 * 1000;

/** What one run did, as counts. */
export interface ReconcileOutcome {
  /** Records read from the provider again. */
  readonly reread: number;
  /** Of those, the ones whose status was not what the provider says (a lost event healed). */
  readonly healed: number;
  /** Records that could not be handled this time (the provider unreachable, a fault). */
  readonly failed: number;
  /** Abandoned checkouts removed (expired sessions and creations that never finished). */
  readonly purged: number;
  /** Refunds left half done that were finished (the subscription is now ended). */
  readonly refundsFinished: number;
  /** Paid checkouts whose events never arrived, recovered through the sync. */
  readonly recovered: number;
}

@Injectable()
export class SubscriptionsReconcileJob {
  private readonly logger = new Logger(SubscriptionsReconcileJob.name);

  constructor(
    private readonly subscriptions: SubscriptionsRepository,
    private readonly sync: SubscriptionsService,
    private readonly billing: SubscriptionsBillingService,
    private readonly events: PaymentEventsRepository,
    private readonly jobs: JobExecutionService,
    private readonly clock: Clock, // AR-24
    @Inject(schedulerConfig.KEY) private readonly config: SchedulerConfig,
  ) {}

  // AR-25: the zone is explicit. 03:30 in Brasília, away from the Caixa import.
  @Cron('30 3 * * *', { timeZone: BRASILIA_TIME_ZONE })
  @InJobContext(SUBSCRIPTIONS_RECONCILE_JOB) // AR-46
  async reconcileDaily(): Promise<void> {
    if (!this.config.subscriptionsReconcile.enabled) return;
    await this.run();
  }

  /**
   * One run, recorded; never throws (a cron callback that throws only logs noise). Answers null
   * when it did not run: another replica holds the lock, or the run failed as a whole.
   */
  async run(): Promise<ReconcileOutcome | null> {
    const token = randomUUID();
    const claimedAt = this.clock.now();
    try {
      await this.events.record(RECONCILE_LOCK_ID, 'job-lock', claimedAt);
      const locked = await this.events.claimProcessing(
        RECONCILE_LOCK_ID,
        token,
        claimedAt,
        new Date(claimedAt.getTime() + RECONCILE_LOCK_MS),
      );
      if (!locked) {
        this.logger.log('Subscriptions reconcile skipped: another instance is running it');
        return null;
      }
    } catch (error) {
      return this.failed(error);
    }
    try {
      const outcome = await this.reconcile();
      this.logger.log(
        `Subscriptions reconciled: ${outcome.reread} re-read, ${outcome.healed} healed, ` +
          `${outcome.failed} failed, ${outcome.purged} abandoned checkouts removed, ` +
          `${outcome.recovered} paid checkouts recovered, ${outcome.refundsFinished} refunds finished`,
      );
      if (outcome.failed > 0) {
        await this.jobs.recordFailure(SUBSCRIPTIONS_RECONCILE_JOB, RunMode.AUTO, 'PARTIAL_FAILURE');
      } else {
        await this.jobs.recordExecution(SUBSCRIPTIONS_RECONCILE_JOB, RunMode.AUTO);
      }
      return outcome;
    } catch (error) {
      return this.failed(error);
    } finally {
      await this.events.releaseProcessing(RECONCILE_LOCK_ID, token).catch(() => undefined);
    }
  }

  private async failed(error: unknown): Promise<null> {
    const code = jobErrorCode(error);
    this.logger.error(`Subscriptions reconcile failed: ${code}`);
    await this.jobs.recordFailure(SUBSCRIPTIONS_RECONCILE_JOB, RunMode.AUTO, code);
    return null;
  }

  private async reconcile(): Promise<ReconcileOutcome> {
    const now = this.clock.now();
    const cutoffs = reconcileCutoffs(now);
    let failed = 0;
    let refundsFinished = 0;
    let recovered = 0;
    let purged = 0;

    // 1. A refund left half done is finished (the money is back, the subscription must end).
    for (const record of await this.subscriptions.findRefundsToFinish(RECONCILE_SIDE_BATCH_SIZE)) {
      try {
        await this.billing.completeRefund(record);
        refundsFinished += 1;
      } catch (error) {
        // A live claim is somebody else's cancel in progress: not a failure of the job.
        if (error instanceof DomainError && error.code === 'CANCEL_IN_PROGRESS') continue;
        failed += 1;
        this.logger.warn(`Refund of ${record.id} could not be finished: ${jobErrorCode(error)}`);
      }
    }

    // 2. Checkouts the buyer may have paid while the events never arrived.
    const unconfirmed = await this.subscriptions.findPendingWithSession(
      cutoffs.sessionBefore,
      RECONCILE_SIDE_BATCH_SIZE,
    );
    for (const record of unconfirmed) {
      try {
        const outcome = await this.billing.recoverPendingCheckout(record);
        if (outcome === 'recovered') recovered += 1;
        if (outcome === 'removed') purged += 1;
      } catch (error) {
        // The provider could not say: the record stays (it is never removed unconfirmed).
        failed += 1;
        this.logger.warn(`Checkout ${record.id} could not be checked: ${jobErrorCode(error)}`);
      }
    }

    // 3. The subscriptions themselves.
    const due = await this.subscriptions.findIdsToReconcile({
      staleBefore: cutoffs.staleBefore,
      lapsedSince: cutoffs.lapsedSince,
      limit: RECONCILE_BATCH_SIZE,
    });
    let reread = 0;
    let healed = 0;
    for (const { id, status } of due) {
      try {
        const record = await this.sync.refresh(id);
        reread += 1;
        if (record.status !== status) healed += 1;
      } catch (error) {
        failed += 1;
        // Sorted after the others next time, so it cannot starve the batch.
        await this.subscriptions.markReconcileFailed(id, now);
        this.logger.warn(`Subscription ${id} could not be re-read: ${jobErrorCode(error)}`);
      }
    }

    // 4. Creations that never finished.
    purged += await this.subscriptions.purgeOrphanedPending(cutoffs.pendingBefore);
    return { reread, healed, failed, purged, refundsFinished, recovered };
  }
}
