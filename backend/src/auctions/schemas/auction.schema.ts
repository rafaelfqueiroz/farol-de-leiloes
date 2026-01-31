import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum PhaseModality {
  SFI_AUCTION = 'SFI_AUCTION',
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

export interface ExpenseRule {
  type: string; // e.g., 'Condomínio', 'Tributos'
  description: string;
}

export enum PaymentMethod {
  OWN_RESOURCES = 'OWN_RESOURCES', // Recursos próprios
  FGTS = 'FGTS', // Permite utilização de FGTS
  FINANCING = 'FINANCING', // Financiamento
}

export interface Phase {
  modality: PhaseModality;
  minimumPrice?: number | null;
  phaseDates?: Date[];
  paymentMethods?: PaymentMethod[];
  expenseRules?: ExpenseRule[];
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

  @Prop({ type: String })
  imageUrl?: string | null;

  @Prop({ type: String })
  description?: string | null;

  @Prop({ type: Boolean, default: false, index: true })
  fulfilled!: boolean;

  @Prop({ index: true })
  updatedAt!: Date;
}

export type AuctionDocument = HydratedDocument<Auction>;

export const AuctionSchema = SchemaFactory.createForClass(Auction);

AuctionSchema.index({ 'address.state': 1, 'address.city': 1 });
AuctionSchema.index({ 'address.state': 1, 'address.city': 1, 'address.neighborhood': 1 });

