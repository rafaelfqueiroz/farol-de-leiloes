import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';

/**
 * The criteria as stored, in a Mixed path (Mongoose casts nothing in it). In code they are the
 * `FilterData` of interfaces/saved-filter.interface.ts; the service converts between the two.
 */
export interface StoredFilterData {
  state?: string;
  city?: string[];
  neighborhood?: string[];
  modality?: string[];
  // AR-17: price bounds in reais, as Decimal128.
  minPrice?: Types.Decimal128 | null;
  maxPrice?: Types.Decimal128 | null;
}

@Schema({ collection: 'savedfilters', timestamps: true })
export class SavedFilterEntity extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserEntity',
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ type: Object, required: true })
  filters!: StoredFilterData;

  // Set by Mongoose (timestamps: true), not a @Prop.
  createdAt!: Date;
  updatedAt!: Date;
}

export type SavedFilterDocument = HydratedDocument<SavedFilterEntity>;

export const SavedFilterSchema = SchemaFactory.createForClass(SavedFilterEntity);

// AR-16 / TS-14: the isolation class of this collection.
markIsolation(SavedFilterSchema, {
  kind: 'account',
  reason:
    "SPEC-002 BR-002-02: the account's own saved searches, scoped by userId (SavedFiltersRepository); no office sees them (DL-002-08)",
});

// Create compound index to ensure unique names per user
SavedFilterSchema.index({ userId: 1, name: 1 }, { unique: true });
