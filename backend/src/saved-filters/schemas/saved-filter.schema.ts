import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export interface FilterData {
  state?: string;
  city?: string[];
  neighborhood?: string[];
  modality?: string[];
  minMargin?: number;
  maxMargin?: number;
}

@Schema({ timestamps: true })
export class SavedFilter extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ type: Object, required: true })
  filters!: FilterData;
}

export const SavedFilterSchema = SchemaFactory.createForClass(SavedFilter);

// Create compound index to ensure unique names per user
SavedFilterSchema.index({ userId: 1, name: 1 }, { unique: true });
