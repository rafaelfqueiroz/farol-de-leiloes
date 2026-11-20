// SPEC-010 BR-010-15, AR-31, SC-28: the daily purge of closed accounts. Closure (account-closure.
// service.ts) ends the account at once; this job deletes or irreversibly anonymises its personal
// data, oldest closure first, within the legal ceiling (ACCOUNT_PURGE_MAX_DAYS, 30). Under a run-
// level lock (two replicas do not both run it) and, per account, an atomic CLAIM (a random token and
// an expiry on the user, one conditional update), so two workers never both finish one account:
//
//   claim -> repeat the closure's effects (a crash between closure and them is repaired here)
//         -> every registered provider's `purge(userId)` in turn (idempotent each)
//         -> the TOMBSTONE, the last step, conditional on the claim: personal fields removed, the
//            email replaced by purged-<id>@removed.invalid (which frees the real address), `purgedAt`.
//
// Resumable (AR-03): a crash or a failure at ANY step leaves the account closed and unpurged with its
// claim released or expiring; the next run repeats every step, each idempotent, and converges. The
// tombstone is written only after every provider succeeded, so a half-purged account is never marked
// purged. A closed account unpurged ACCOUNT_PURGE_ALERT_DAYS after closure raises an error log (a
// count, never an id). Every run is recorded in `jobexecutions` (AR-03); the logs carry counts only
// (SC-15). AR-04: switched off by ACCOUNT_PURGE_ENABLED. AR-25: the cron states its zone.
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { BRASILIA_TIME_ZONE } from '../../common/clock/brasilia-time.js';
import { Clock } from '../../common/clock/clock.js';
import { RunMode } from '../../common/job-execution.js';
import { InJobContext } from '../../common/observability/job-context.js';
import { JobExecutionService } from '../../common/services/job-execution.service.js';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import businessConfig from '../../config/business.config.js';
import schedulerConfig, { type SchedulerConfig } from '../../config/scheduler.config.js';
import { UsersService } from '../../users/users.service.js';
import { claimExpiry, overdueClosedBefore } from '../domain/account-purge.js';
import { PersonalDataRegistry } from '../registry/personal-data-registry.js';
import { AccountClosureService } from './account-closure.service.js';
import { JobLockService } from './job-lock.service.js';

export const ACCOUNT_PURGE_JOB = 'account-purge';
export const ACCOUNT_PURGE_LOCK = 'job:account-purge';
export const ACCOUNT_PURGE_LOCK_MS = 2 * 60 * 60 * 1000;
/** Bounds one run: the oldest closures first; the rest is purged tomorrow (the alert watches it). */
export const PURGE_BATCH_SIZE = 100;

/** What one run did, as counts. */
export interface PurgeOutcome {
  readonly purged: number;
  /** Accounts another worker held or finished meanwhile. */
  readonly skipped: number;
  /** Accounts whose purge failed this time; repeated by the next run. */
  readonly failed: number;
  /** Closed accounts still unpurged ACCOUNT_PURGE_ALERT_DAYS or more after their closure. */
  readonly overdue: number;
}

@Injectable()
export class AccountPurgeJob {
  private readonly logger = new Logger(AccountPurgeJob.name);

  constructor(
    private readonly users: UsersService,
    private readonly registry: PersonalDataRegistry,
    private readonly closure: AccountClosureService,
    private readonly locks: JobLockService,
    private readonly jobs: JobExecutionService,
    private readonly clock: Clock, // AR-24
    @Inject(schedulerConfig.KEY) private readonly scheduler: SchedulerConfig,
    @Inject(businessConfig.KEY) private readonly config: ConfigType<typeof businessConfig>,
  ) {}

  // AR-25: the zone is explicit. 04:10 in Brasília, away from the Caixa import (03:00) and the
  // subscriptions reconcile (03:30).
  @Cron('10 4 * * *', { timeZone: BRASILIA_TIME_ZONE })
  @InJobContext(ACCOUNT_PURGE_JOB) // AR-46
  async purgeDaily(): Promise<void> {
    if (!this.scheduler.accountPurge.enabled) return;
    await this.run();
  }

  /**
   * One run, recorded; never throws (a cron callback that throws only logs noise). Answers null when
   * it did not run: another replica holds the lock, or the run failed as a whole.
   */
  async run(): Promise<PurgeOutcome | null> {
    let locked;
    try {
      locked = await this.locks.runLocked(ACCOUNT_PURGE_LOCK, ACCOUNT_PURGE_LOCK_MS, () =>
        this.purgeBatch(),
      );
    } catch (error) {
      return this.failedRun(error);
    }
    if (!locked.ran) {
      this.logger.log('Account purge skipped: another instance is running it');
      return null;
    }
    const outcome = locked.result;
    this.logger.log(
      `Account purge: ${outcome.purged} purged, ${outcome.skipped} skipped, ${outcome.failed} failed, ` +
        `${outcome.overdue} overdue`,
    );
    if (outcome.failed > 0) {
      await this.jobs.recordFailure(ACCOUNT_PURGE_JOB, RunMode.AUTO, 'PARTIAL_FAILURE');
    } else {
      await this.jobs.recordExecution(ACCOUNT_PURGE_JOB, RunMode.AUTO);
    }
    return outcome;
  }

  private async failedRun(error: unknown): Promise<null> {
    const code = jobErrorCode(error);
    this.logger.error(`Account purge failed: ${code}`);
    await this.jobs.recordFailure(ACCOUNT_PURGE_JOB, RunMode.AUTO, code);
    return null;
  }

  private async purgeBatch(): Promise<PurgeOutcome> {
    const now = this.clock.now();
    let purged = 0;
    let skipped = 0;
    let failed = 0;
    for (const userId of await this.users.findPurgeCandidates(now, PURGE_BATCH_SIZE)) {
      try {
        if ((await this.purgeAccount(userId)) === 'purged') purged += 1;
        else skipped += 1;
      } catch (error) {
        failed += 1;
        // SC-15: the failure's code only, never the account, never the provider's message.
        this.logger.warn(`An account could not be purged this time: ${jobErrorCode(error)}`);
      }
    }
    return { purged, skipped, failed, overdue: await this.alertOverdue() };
  }

  /**
   * Purges one closed account: claim it, repeat the closure's effects, run every provider, write
   * the tombstone. `skipped` when the claim is not ours or was lost before the tombstone (another
   * worker holds or finished it); a failing step throws after the claim is released, and the next
   * run repeats everything. Public for the fault-injection specs that drive one account.
   */
  async purgeAccount(userId: string): Promise<'purged' | 'skipped'> {
    const token = randomUUID();
    const now = this.clock.now();
    if (!(await this.users.claimForPurge(userId, token, now, claimExpiry(now)))) return 'skipped';
    try {
      // A closure whose effects crashed half way is repaired here; a step that still fails is
      // logged by the closure service's caller path and does not hold the deletion back.
      const failedEffects = await this.closure.applyClosureEffects(userId);
      if (failedEffects.length > 0) {
        this.logger.warn(`Closure effects incomplete at purge: ${failedEffects.join(', ')}`);
      }
      await this.registry.purge(userId);
      return (await this.users.completePurge(userId, token, this.clock.now()))
        ? 'purged'
        : 'skipped';
    } catch (error) {
      await this.users.releasePurgeClaim(userId, token).catch(() => undefined);
      throw error;
    }
  }

  /**
   * BR-010-15: closed accounts still unpurged `ACCOUNT_PURGE_ALERT_DAYS` after their closure raise an
   * error (the legal ceiling, ACCOUNT_PURGE_MAX_DAYS, is days further away). A count, never who.
   */
  private async alertOverdue(): Promise<number> {
    const { accountPurgeAlertDays, accountPurgeMaxDays } = this.config.privacy;
    const overdue = await this.users.countOverduePurges(
      overdueClosedBefore(this.clock.now(), accountPurgeAlertDays),
    );
    if (overdue > 0) {
      this.logger.error(
        `${overdue} closed account(s) not purged ${accountPurgeAlertDays} days after closure; ` +
          `the legal limit is ${accountPurgeMaxDays} days (BR-010-15)`,
      );
    }
    return overdue;
  }
}
