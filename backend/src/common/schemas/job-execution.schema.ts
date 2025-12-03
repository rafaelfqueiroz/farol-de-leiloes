import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum RunMode {
  MANUAL = 'MANUAL',
  AUTO = 'AUTO',
}

@Schema({ timestamps: true })
export class JobExecution {
  @Prop({ required: true, index: true })
  jobName!: string;

  @Prop({ required: true, type: String, enum: RunMode })
  runMode!: RunMode;

  @Prop({ required: true, type: Date })
  finishedAt!: Date;
}

export type JobExecutionDocument = HydratedDocument<JobExecution>;
export const JobExecutionSchema = SchemaFactory.createForClass(JobExecution);

// Create compound index for efficient queries
JobExecutionSchema.index({ jobName: 1, runMode: 1, finishedAt: -1 });