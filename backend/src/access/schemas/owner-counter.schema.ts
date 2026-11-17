import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * SPEC-002 BR-002-13 / AR-15: one counter per owner and key (e.g. journeys in progress), so a plan
 * limit is checked and counted in ONE conditional update. Owned (AR-11): it has `ownerId`, so the
 * isolation gate requires its spec (test/isolation/owner-counter.isolation.spec.ts) as soon as a
 * production module registers it.
 */
@Schema({ collection: 'ownerCounters', timestamps: true })
export class OwnerCounterEntity {
  @Prop({ required: true, type: String, enum: ['office', 'self_advised'] })
  ownerType!: 'office' | 'self_advised';

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  ownerId!: Types.ObjectId;

  /** What is counted, e.g. 'journeys.inProgress'. Server-chosen, never from a request. */
  @Prop({ required: true, type: String })
  key!: string;

  @Prop({ required: true, type: Number, default: 0, min: 0 })
  value!: number;
}

export type OwnerCounterDocument = HydratedDocument<OwnerCounterEntity>;

export const OwnerCounterSchema = SchemaFactory.createForClass(OwnerCounterEntity);

// AR-11 / AR-27: the owner first; unique, so two first acquires cannot create two counters.
OwnerCounterSchema.index({ ownerType: 1, ownerId: 1, key: 1 }, { unique: true });
