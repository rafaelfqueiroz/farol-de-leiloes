import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Favorite extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  auctionCode!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Auction',
    required: true,
    index: true
  })
  auction!: Types.ObjectId;
}

export const FavoriteSchema = SchemaFactory.createForClass(Favorite);

// Create compound index to ensure a user can't favorite the same auction twice
FavoriteSchema.index({ userId: 1, auctionCode: 1 }, { unique: true });
