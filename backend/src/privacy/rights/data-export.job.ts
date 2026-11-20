// SPEC-010 BR-010-11, DL-010-06, AR-03, AR-04, AR-25: the two schedules of the data export worker
// (data-export.worker.ts): building queued exports every couple of minutes, and ending the life of
// exports (and deleting the files nobody references) once an hour. Each under its own run-level lock.
// Switched off by DATA_EXPORT_ENABLED. A run that found nothing to do records nothing in
// `jobexecutions` (a run every two minutes would bury the day's real runs); one that built, failed
// or cleaned something, or failed as a whole, is recorded. Logs carry counts only (SC-15).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BRASILIA_TIME_ZONE } from '../../common/clock/brasilia-time.js';
import { RunMode } from '../../common/job-execution.js';
import { InJobContext } from '../../common/observability/job-context.js';
import { JobExecutionService } from '../../common/services/job-execution.service.js';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import schedulerConfig, { type SchedulerConfig } from '../../config/scheduler.config.js';
import {
  type BuildOutcome,
  DataExportWorker,
  type ExpiryOutcome,
  EXPORT_CLAIM_LEASE_MS,
} from './data-export.worker.js';
import { JobLockService } from './job-lock.service.js';

export const DATA_EXPORT_BUILD_JOB = 'data-export-build';
export const DATA_EXPORT_EXPIRY_JOB = 'data-export-expiry';

@Injectable()
export class DataExportJob {
  private readonly logger = new Logger(DataExportJob.name);

  constructor(
    private readonly worker: DataExportWorker,
    private readonly locks: JobLockService,
    private readonly jobs: JobExecutionService,
    @Inject(schedulerConfig.KEY) private readonly scheduler: SchedulerConfig,
  ) {}

  // AR-25: the zone is explicit, even for a job that runs every two minutes.
  @Cron('*/2 * * * *', { timeZone: BRASILIA_TIME_ZONE })
  @InJobContext(DATA_EXPORT_BUILD_JOB) // AR-46
  async buildQueued(): Promise<void> {
    if (!this.scheduler.dataExport.enabled) return;
    await this.runBuild();
  }

  @Cron('17 * * * *', { timeZone: BRASILIA_TIME_ZONE })
  @InJobContext(DATA_EXPORT_EXPIRY_JOB) // AR-46
  async expire(): Promise<void> {
    if (!this.scheduler.dataExport.enabled) return;
    await this.runExpiry();
  }

  /** One build run; never throws. Null when it did not run (nothing queued, locked, or failed). */
  async runBuild(): Promise<BuildOutcome | null> {
    try {
      if (!(await this.worker.hasWork())) return null;
      const locked = await this.locks.runLocked(
        `job:${DATA_EXPORT_BUILD_JOB}`,
        EXPORT_CLAIM_LEASE_MS,
        () => this.worker.processQueued(),
      );
      if (!locked.ran) {
        this.logger.log('Data export build skipped: another instance is running it');
        return null;
      }
      const outcome = locked.result;
      if (outcome.ready + outcome.failed + outcome.discarded > 0) {
        this.logger.log(
          `Data exports: ${outcome.ready} ready, ${outcome.failed} failed, ${outcome.discarded} discarded`,
        );
        await this.jobs.recordExecution(DATA_EXPORT_BUILD_JOB, RunMode.AUTO);
      }
      return outcome;
    } catch (error) {
      return this.failed(DATA_EXPORT_BUILD_JOB, error);
    }
  }

  /** One expiry run; never throws. */
  async runExpiry(): Promise<ExpiryOutcome | null> {
    try {
      const locked = await this.locks.runLocked(
        `job:${DATA_EXPORT_EXPIRY_JOB}`,
        EXPORT_CLAIM_LEASE_MS,
        () => this.worker.expireDue(),
      );
      if (!locked.ran) {
        this.logger.log('Data export expiry skipped: another instance is running it');
        return null;
      }
      const outcome = locked.result;
      if (outcome.expired + outcome.cleaned + outcome.failed > 0) {
        this.logger.log(
          `Data export expiry: ${outcome.expired} expired, ${outcome.cleaned} files cleaned, ${outcome.failed} not deleted`,
        );
        if (outcome.failed > 0) {
          await this.jobs.recordFailure(DATA_EXPORT_EXPIRY_JOB, RunMode.AUTO, 'PARTIAL_FAILURE');
        } else {
          await this.jobs.recordExecution(DATA_EXPORT_EXPIRY_JOB, RunMode.AUTO);
        }
      }
      return outcome;
    } catch (error) {
      return this.failed(DATA_EXPORT_EXPIRY_JOB, error);
    }
  }

  private async failed(job: string, error: unknown): Promise<null> {
    const code = jobErrorCode(error);
    this.logger.error(`${job} failed: ${code}`);
    await this.jobs.recordFailure(job, RunMode.AUTO, code);
    return null;
  }
}
