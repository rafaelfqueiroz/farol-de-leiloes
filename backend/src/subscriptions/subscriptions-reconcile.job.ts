// SPEC-012 (ADR-005): the safety net under the webhook. Stripe retries a failed delivery for about
// 3 days and then gives up, and a holder that died after acknowledging a covered event leaves its
// information unread, so a record can stay behind the provider until some later event. Once a day
// this re-reads every subscription that is not lapsed (and the ones that lapsed recently) through
// the SAME `SubscriptionsService.refresh` path the webhook uses (lease, dirty mark), and removes
// the checkouts nobody paid. It relies on the provider's dunning ENDING in a cancel, which is a
// required provider setting (ARCHITECTURE §13, runbook).
//
// AR-03: idempotent and safe to re-run; every run is recorded (success or failure) in
// jobexecutions. AR-04: switched off by SUBSCRIPTIONS_RECONCILE_ENABLED. AR-25: the cron states its
// zone. SC-15: the logs carry counts and stable codes only.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BRASILIA_TIME_ZONE } from '../common/clock/brasilia-time.js';
import { Clock } from '../common/clock/clock.js';
import { RunMode } from '../common/job-execution.js';
import { InJobContext } from '../common/observability/job-context.js';
import { jobErrorCode } from '../common/services/job-error-code.js';
import { JobExecutionService } from '../common/services/job-execution.service.js';
import schedulerConfig, { type SchedulerConfig } from '../config/scheduler.config.js';
import { reconcileCutoffs } from './domain/reconcile-window.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';
import { SubscriptionsService } from './subscriptions.service.js';

export const SUBSCRIPTIONS_RECONCILE_JOB = 'subscriptions-reconcile';

/** Bounds one run: the oldest syncs first; the rest are read tomorrow (or by their next event). */
export const RECONCILE_BATCH_SIZE = 200;

/** What one run did, as counts. */
export interface ReconcileOutcome {
  /** Records read from the provider again. */
  readonly reread: number;
  /** Of those, the ones whose status was not what the provider says (a lost event healed). */
  readonly healed: number;
  /** Records that could not be read this time (the provider unreachable, a fault). */
  readonly failed: number;
  /** Abandoned checkouts removed. */
  readonly purged: number;
}

@Injectable()
export class SubscriptionsReconcileJob {
  private readonly logger = new Logger(SubscriptionsReconcileJob.name);

  constructor(
    private readonly subscriptions: SubscriptionsRepository,
    private readonly sync: SubscriptionsService,
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

  /** One run, recorded; never throws (a cron callback that throws only logs noise). */
  async run(): Promise<ReconcileOutcome | null> {
    try {
      const outcome = await this.reconcile();
      this.logger.log(
        `Subscriptions reconciled: ${outcome.reread} re-read, ${outcome.healed} healed, ` +
          `${outcome.failed} failed, ${outcome.purged} abandoned checkouts removed`,
      );
      if (outcome.failed > 0) {
        await this.jobs.recordFailure(SUBSCRIPTIONS_RECONCILE_JOB, RunMode.AUTO, 'PARTIAL_FAILURE');
      } else {
        await this.jobs.recordExecution(SUBSCRIPTIONS_RECONCILE_JOB, RunMode.AUTO);
      }
      return outcome;
    } catch (error) {
      const code = jobErrorCode(error);
      this.logger.error(`Subscriptions reconcile failed: ${code}`);
      await this.jobs.recordFailure(SUBSCRIPTIONS_RECONCILE_JOB, RunMode.AUTO, code);
      return null;
    }
  }

  private async reconcile(): Promise<ReconcileOutcome> {
    const cutoffs = reconcileCutoffs(this.clock.now());
    const due = await this.subscriptions.findIdsToReconcile({
      staleBefore: cutoffs.staleBefore,
      lapsedSince: cutoffs.lapsedSince,
      limit: RECONCILE_BATCH_SIZE,
    });
    let reread = 0;
    let healed = 0;
    let failed = 0;
    for (const { id, status } of due) {
      try {
        const record = await this.sync.refresh(id);
        reread += 1;
        if (record.status !== status) healed += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`Subscription ${id} could not be re-read: ${jobErrorCode(error)}`);
      }
    }
    const purged = await this.subscriptions.purgeStalePending(cutoffs.pendingBefore);
    return { reread, healed, failed, purged };
  }
}
