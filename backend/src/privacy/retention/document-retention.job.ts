// SPEC-010 BR-010-21, AR-03, AR-04, AR-25: the daily run of the document retention. Switched off by
// DOCUMENT_RETENTION_ENABLED; under a run-level lock so two replicas never both run it; every run is
// recorded in `jobexecutions` (AR-03) and logs counts only (SC-15). The rule and the orchestration
// are RetentionService's.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BRASILIA_TIME_ZONE } from '../../common/clock/brasilia-time.js';
import { RunMode } from '../../common/job-execution.js';
import { InJobContext } from '../../common/observability/job-context.js';
import { JobExecutionService } from '../../common/services/job-execution.service.js';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import schedulerConfig, { type SchedulerConfig } from '../../config/scheduler.config.js';
import { JobLockService } from '../rights/job-lock.service.js';
import { type RetentionOutcome, RetentionService } from './retention.service.js';

export const DOCUMENT_RETENTION_JOB = 'document-retention';
export const DOCUMENT_RETENTION_LOCK = 'job:document-retention';
export const DOCUMENT_RETENTION_LOCK_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class DocumentRetentionJob {
  private readonly logger = new Logger(DocumentRetentionJob.name);

  constructor(
    private readonly retention: RetentionService,
    private readonly locks: JobLockService,
    private readonly jobs: JobExecutionService,
    @Inject(schedulerConfig.KEY) private readonly scheduler: SchedulerConfig,
  ) {}

  // AR-25: the zone is explicit. 04:30 in Brasília, after the account purge (04:10) and its alert (04:20).
  @Cron('30 4 * * *', { timeZone: BRASILIA_TIME_ZONE })
  @InJobContext(DOCUMENT_RETENTION_JOB) // AR-46
  async deleteDaily(): Promise<void> {
    if (!this.scheduler.documentRetention.enabled) return;
    await this.run();
  }

  /**
   * One run, recorded; never throws. Null when it did not run: another replica holds the lock, or
   * the run failed as a whole. A journey that failed makes the run `PARTIAL_FAILURE` (retried tomorrow).
   */
  async run(): Promise<RetentionOutcome | null> {
    let locked;
    try {
      locked = await this.locks.runLocked(DOCUMENT_RETENTION_LOCK, DOCUMENT_RETENTION_LOCK_MS, () =>
        this.retention.purgeDue(),
      );
    } catch (error) {
      const code = jobErrorCode(error);
      this.logger.error(`Document retention failed: ${code}`);
      await this.jobs.recordFailure(DOCUMENT_RETENTION_JOB, RunMode.AUTO, code);
      return null;
    }
    if (!locked.ran) {
      this.logger.log('Document retention skipped: another instance is running it');
      return null;
    }
    const outcome = locked.result;
    this.logger.log(
      `Document retention: ${outcome.deleted} journeys deleted (${outcome.files} files), ` +
        `${outcome.notDue} not due, ${outcome.failed} failed, ${outcome.unrecorded} unrecorded`,
    );
    if (outcome.notDue > 0) {
      this.logger.warn(
        `The closed-journey files source listed ${outcome.notDue} journeys that are not due yet`,
      );
    }
    if (outcome.unrecorded > 0) {
      this.logger.error(
        `${outcome.unrecorded} journeys had their files deleted but no log row written (BR-010-21)`,
      );
    }
    if (outcome.failed > 0) {
      await this.jobs.recordFailure(DOCUMENT_RETENTION_JOB, RunMode.AUTO, 'PARTIAL_FAILURE');
    } else {
      await this.jobs.recordExecution(DOCUMENT_RETENTION_JOB, RunMode.AUTO);
    }
    return outcome;
  }
}
