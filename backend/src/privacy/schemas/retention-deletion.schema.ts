import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';
import { makeInsertOnly } from './insert-only.js';

/**
 * SPEC-010 BR-010-21: one row per journey whose documents the retention job deleted, with the journey,
 * the number of files and the date, NEVER a document's content or name. Insert-only (AR-30): the
 * unique `journeyId` makes a repeat (a run repairing a crash, two replicas) end with one row.
 *
 * The owner is kept as `journeyOwnerType` / `journeyOwnerId`, not `ownerType` / `ownerId`: a schema
 * with an `ownerId` path is an OWNED collection (AR-11) read through the owner-scoped repository,
 * and this is a platform log that is never read per owner (AR-16, `internal`).
 */
@Schema({ collection: 'retentionDeletions', timestamps: true })
export class RetentionDeletionEntity {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  journeyId!: Types.ObjectId;

  /** The journey's owner type (AR-11), as the source reported it. */
  @Prop({ required: true, type: String })
  journeyOwnerType!: string;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  journeyOwnerId!: Types.ObjectId;

  /** How many files the deletion removed. A count, never names (BR-010-21). */
  @Prop({ required: true, type: Number, min: 0 })
  fileCount!: number;

  /** From the injected Clock (AR-24). */
  @Prop({ required: true, type: Date })
  deletedAt!: Date;
}

export type RetentionDeletionDocument = HydratedDocument<RetentionDeletionEntity>;

export const RetentionDeletionSchema = SchemaFactory.createForClass(RetentionDeletionEntity);

// AR-27 / AR-29: built in production by migration 0010-retention-legal-indexes, whose unit spec
// holds it equal to this one. One log row per journey, whatever races.
RetentionDeletionSchema.index({ journeyId: 1 }, { unique: true, name: 'one_deletion_per_journey' });

makeInsertOnly(RetentionDeletionSchema, 'retentionDeletions');

markIsolation(RetentionDeletionSchema, {
  kind: 'internal',
  reason:
    'Log of retention deletions (SPEC-010 BR-010-21): journey and owner ids, a file count and a date, written by the retention job and read by operations, never listed per owner or account',
});
