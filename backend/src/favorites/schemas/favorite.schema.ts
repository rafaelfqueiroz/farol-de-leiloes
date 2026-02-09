import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ collection: 'favorites', timestamps: true })
export class FavoriteEntity extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserEntity',
    required: true,
    index: true
  })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  auctionCode!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'AuctionEntity',
    required: true,
    index: true
  })
  auction!: Types.ObjectId;
}

export type FavoriteDocument = HydratedDocument<FavoriteEntity>;

export const FavoriteSchema = SchemaFactory.createForClass(FavoriteEntity);

// Create compound index to ensure a user can't favorite the same auction twice
FavoriteSchema.index({ userId: 1, auctionCode: 1 }, { unique: true });
