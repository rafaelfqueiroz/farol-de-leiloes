import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum RunMode {
  MANUAL = 'MANUAL',
  AUTO = 'AUTO',
}

/** AR-03: the outcome of a run. */
export enum JobStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Schema({ collection: 'jobexecutions', timestamps: true })
export class JobExecution {
  @Prop({ required: true, index: true })
  jobName!: string;

  @Prop({ required: true, type: String, enum: RunMode })
  runMode!: RunMode;

  @Prop({ required: true, type: Date })
  finishedAt!: Date;

  /**
   * Every run written since #36 sets it. Rows recorded before then have none and were all
   * successful runs (only success was recorded), so readers treat an absent status as SUCCESS
   * (AR-28: the reader accepts both shapes; no backfill needed).
   */
  @Prop({ type: String, enum: JobStatus })
  status?: JobStatus;

  /**
   * A FAILED run's stable code (job-error-code.ts): an error class or a DomainError code, never
   * a message, a value or anything personal (SC-15).
   */
  @Prop({ type: String })
  errorCode?: string;
}

export type JobExecutionDocument = HydratedDocument<JobExecution>;
export const JobExecutionSchema = SchemaFactory.createForClass(JobExecution);

// Create compound index for efficient queries
JobExecutionSchema.index({ jobName: 1, runMode: 1, finishedAt: -1 });
// AR-27: the last run of a job in any run mode (GET /api/health, AR-48).
JobExecutionSchema.index({ jobName: 1, finishedAt: -1 });
