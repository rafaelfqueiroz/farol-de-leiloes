import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JobExecution, JobExecutionDocument, RunMode } from '../schemas/job-execution.schema';

@Injectable()
export class JobExecutionService {
  constructor(
    @InjectModel(JobExecution.name)
    private readonly jobExecutionRepository: Model<JobExecutionDocument>,
  ) {}

  /**
   * Record a job execution
   */
  async recordExecution(jobName: string, runMode: RunMode): Promise<JobExecution> {
    const execution = new this.jobExecutionRepository({
      jobName,
      runMode,
      finishedAt: new Date(),
    });
    return execution.save();
  }

  /**
   * Get the last execution for a specific job and run mode
   */
  async getLastExecution(jobName: string, runMode: RunMode): Promise<JobExecution | null> {
    return this.jobExecutionRepository
      .findOne({ jobName, runMode })
      .sort({ finishedAt: -1 })
      .lean()
      .exec();
  }

  /**
   * Check if a job ran recently (within specified hours)
   */
  async hasRunRecently(jobName: string, runMode: RunMode, withinHours: number): Promise<boolean> {
    const lastExecution = await this.getLastExecution(jobName, runMode);
    if (!lastExecution) {
      return false;
    }

    const hoursSinceLastRun = (Date.now() - lastExecution.finishedAt.getTime()) / (1000 * 60 * 60);
    return hoursSinceLastRun < withinHours;
  }
}