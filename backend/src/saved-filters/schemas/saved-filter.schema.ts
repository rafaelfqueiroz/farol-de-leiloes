import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export interface FilterData {
  state?: string;
  city?: string[];
  neighborhood?: string[];
  modality?: string[];
  minMargin?: number;
  maxMargin?: number;
}

@Schema({ timestamps: true })
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
  filters!: FilterData;
}

export type SavedFilterDocument = HydratedDocument<SavedFilterEntity>;

export const SavedFilterSchema = SchemaFactory.createForClass(SavedFilterEntity);

// Create compound index to ensure unique names per user
SavedFilterSchema.index({ userId: 1, name: 1 }, { unique: true });
