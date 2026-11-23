// SPEC-009 BR-009-07, AR-03, AR-04, AR-25: the worker of the support outbox. Every minute it takes the
// requests that still owe an email (a first attempt that failed, a retry that came due) and delivers
// them through the same claim the request's own first attempt uses, so two runs, on one replica or
// two, never send one mail twice at the same time: no run-level lock is needed, the claim is per
// request. Switched off by SUPPORT_MAIL_JOB_ENABLED. A run that found nothing records nothing in
// `jobexecutions` (a run a minute would bury the day's real runs); one that delivered, retried or gave
// up on something, or failed as a whole, is recorded. Logs carry counts and codes only (SC-15).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BRASILIA_TIME_ZONE } from '../common/clock/brasilia-time.js';
import { RunMode } from '../common/job-execution.js';
import { InJobContext } from '../common/observability/job-context.js';
import { jobErrorCode } from '../common/services/job-error-code.js';
import { JobExecutionService } from '../common/services/job-execution.service.js';
import schedulerConfig, { type SchedulerConfig } from '../config/scheduler.config.js';
import { type DueRunOutcome, SupportMailService } from './support-mail.service.js';

export const SUPPORT_MAIL_JOB = 'support-mail';

@Injectable()
export class SupportMailJob {
  private readonly logger = new Logger(SupportMailJob.name);

  constructor(
    private readonly mail: SupportMailService,
    private readonly jobs: JobExecutionService,
    @Inject(schedulerConfig.KEY) private readonly scheduler: SchedulerConfig,
  ) {}

  // AR-25: the zone is explicit, even for a job that runs every minute.
  @Cron('* * * * *', { timeZone: BRASILIA_TIME_ZONE })
  @InJobContext(SUPPORT_MAIL_JOB) // AR-46
  async deliverDue(): Promise<void> {
    if (!this.scheduler.supportMail.enabled) return;
    await this.run();
  }

  /** One run; never throws. Null when it failed as a whole. */
  async run(): Promise<DueRunOutcome | null> {
    try {
      const outcome = await this.mail.processDue();
      if (outcome.requests > 0) {
        this.logger.log(
          `Support mail: ${outcome.requests} requests, ${outcome.sent} emails sent, ${outcome.retried} to retry, ${outcome.gaveUp} given up`,
        );
        if (outcome.gaveUp > 0) {
          await this.jobs.recordFailure(SUPPORT_MAIL_JOB, RunMode.AUTO, 'MAIL_GAVE_UP');
        } else {
          await this.jobs.recordExecution(SUPPORT_MAIL_JOB, RunMode.AUTO);
        }
      }
      return outcome;
    } catch (error) {
      const code = jobErrorCode(error);
      this.logger.error(`${SUPPORT_MAIL_JOB} failed: ${code}`);
      await this.jobs.recordFailure(SUPPORT_MAIL_JOB, RunMode.AUTO, code);
      return null;
    }
  }
}
