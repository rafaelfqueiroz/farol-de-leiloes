import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Clock } from '../clock/clock';
import { JobExecution, JobExecutionDocument } from '../schemas/job-execution.schema';
import { type JobExecutionRecord, type JobOutcome, JobStatus, RunMode } from '../job-execution';

@Injectable()
export class JobExecutionService {
  constructor(
    @InjectModel(JobExecution.name)
    private readonly jobExecutionRepository: Model<JobExecutionDocument>,
    private readonly clock: Clock,
  ) {}

  /**
   * Record a successful job execution
   */
  async recordExecution(jobName: string, runMode: RunMode): Promise<JobExecutionRecord> {
    return this.record({ jobName, runMode, status: JobStatus.SUCCESS });
  }

  /**
   * AR-03: record a failed run, with a stable code only (job-error-code.ts, SC-15).
   */
  async recordFailure(
    jobName: string,
    runMode: RunMode,
    errorCode: string,
  ): Promise<JobExecutionRecord> {
    return this.record({ jobName, runMode, status: JobStatus.FAILED, errorCode });
  }

  private async record(
    fields: Pick<JobExecutionRecord, 'jobName' | 'runMode' | 'status' | 'errorCode'>,
  ): Promise<JobExecutionRecord> {
    const execution = new this.jobExecutionRepository({
      ...fields,
      finishedAt: this.clock.now(), // AR-24
    });
    return execution.save();
  }

  /**
   * Get the last successful execution for a specific job and run mode. A row without a status
   * predates #36 and was a success, hence `$ne` rather than `SUCCESS`.
   */
  async getLastExecution(jobName: string, runMode: RunMode): Promise<JobExecutionRecord | null> {
    return this.jobExecutionRepository
      .findOne({ jobName, runMode, status: { $ne: JobStatus.FAILED } })
      .sort({ finishedAt: -1 })
      .lean()
      .exec();
  }

  /**
   * The last run of a job in any run mode, successful or not (GET /api/health, AR-48).
   */
  async getLastOutcome(jobName: string): Promise<JobOutcome | null> {
    const last = await this.jobExecutionRepository
      .findOne({ jobName })
      .sort({ finishedAt: -1 })
      .lean()
      .exec();
    if (!last) return null;
    return {
      status: last.status ?? JobStatus.SUCCESS,
      runMode: last.runMode,
      finishedAt: last.finishedAt,
      ...(last.errorCode === undefined ? {} : { errorCode: last.errorCode }),
    };
  }

  /**
   * Check if a job ran successfully recently (within specified hours). A FAILED run does not
   * count: the next scheduled run retries instead of being skipped.
   */
  async hasRunRecently(jobName: string, runMode: RunMode, withinHours: number): Promise<boolean> {
    const lastExecution = await this.getLastExecution(jobName, runMode);
    if (!lastExecution) {
      return false;
    }

    // AR-24: measured against the injected clock, so the window is testable (TS-06).
    const hoursSinceLastRun =
      (this.clock.now().getTime() - lastExecution.finishedAt.getTime()) / (1000 * 60 * 60);
    return hoursSinceLastRun < withinHours;
  }
}
