import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';

/**
 * SPEC-010 (AR-03): the run-level lock of a privacy job, so two replicas never run the purge or the
 * export worker at once. One document per job, claimed with one conditional update (a token and its
 * expiry: a crashed run's lock simply expires). It holds no account data.
 */
@Schema({ collection: 'jobLocks', timestamps: true })
export class JobLockEntity {
  /** The job's name, e.g. `job:account-purge`. */
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: false })
  token?: string;

  /** The lock is held until this instant; at the instant itself it is free. */
  @Prop({ type: Date, required: false })
  heldUntil?: Date;
}

export type JobLockDocument = HydratedDocument<JobLockEntity>;

export const JobLockSchema = SchemaFactory.createForClass(JobLockEntity);

markIsolation(JobLockSchema, {
  kind: 'internal',
  reason: 'Run-level locks of the privacy jobs (SPEC-010): operations data, no account data',
});
