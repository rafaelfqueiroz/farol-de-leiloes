import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum PhaseModality {
  FIRST_AUCTION = 'FIRST_AUCTION',
  SECOND_AUCTION = 'SECOND_AUCTION',
  OPEN_BIDDING = 'OPEN_BIDDING',
  DIRECT_ONLINE_SALES = 'DIRECT_ONLINE_SALES',
  ONLINE_SALES = 'ONLINE_SALES',
}

export interface Address {
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipcode?: string;
}

export interface Phase {
  modality: PhaseModality;
  minimumPrice?: number | null;
  date?: Date | null;
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Auction {
  @Prop({ index: true, unique: true })
  code!: string;

  @Prop({ type: String })
  title?: string | null;

  @Prop({ type: Object })
  address?: Address;

  @Prop({ type: Number })
  appraisalPrice?: number | null;

  @Prop({ type: Array })
  phases?: Phase[];

  @Prop({ type: String })
  detailsUrl?: string | null;

  @Prop({ index: true })
  updatedAt!: Date;
}

export type AuctionDocument = HydratedDocument<Auction>;

export const AuctionSchema = SchemaFactory.createForClass(Auction);

AuctionSchema.index({ 'address.state': 1, 'address.city': 1 });

