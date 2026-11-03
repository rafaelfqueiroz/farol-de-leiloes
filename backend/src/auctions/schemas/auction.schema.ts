import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import type { StoredMoney } from '../../common/money/stored-money';

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

export interface AuctionFile {
  originalUrl: string; // Caixa URL (kept for reference/fallback)
  storageKey?: string; // R2 object key (for signed URL generation)
  publicUrl?: string; // R2 public URL (only for images)
  mimeType: string; // e.g., 'image/jpeg', 'application/pdf'
  size?: number; // File size in bytes
  uploadedAt?: Date; // When uploaded to R2
}

export enum PaymentMethod {
  OWN_RESOURCES = 'OWN_RESOURCES', // Recursos próprios
  FGTS = 'FGTS', // Permite utilização de FGTS
  FINANCING = 'FINANCING', // Financiamento
}

/**
 * A phase as stored. `phases` and `currentPhase` are Mixed paths, so Mongoose casts nothing in
 * them: every writer converts through toStoredPhase (auction.mapper.ts) and every reader through
 * fromStoredPhase. In code a phase is the `Phase` of interfaces/auction.interface.ts.
 */
export interface StoredPhase {
  modality: PhaseModality;
  // AR-17: reais as Decimal128. EXPAND (AR-28): remove in contract step, #34 PR 2 — documents
  // written before #34 hold a number.
  minimumPrice?: StoredMoney | null;
  phaseDates?: Date[];
  paymentMethods?: PaymentMethod[];
  expenseRules?: ExpenseRule[];
}

@Schema({ collection: 'auctions', timestamps: { createdAt: true, updatedAt: false } })
export class AuctionEntity {
  @Prop({ index: true, unique: true })
  code!: string;

  @Prop({ type: String })
  title?: string | null;

  @Prop({ type: Object })
  address?: Address;

  // AR-17: reais as Decimal128. EXPAND (AR-28): remove in contract step, #34 PR 2 — legacy
  // documents hold a number (reais too, so a hydrated read casting it to Decimal128 keeps its
  // value); lean reads see either shape and go through fromStoredMoney.
  @Prop({ type: MongooseSchema.Types.Decimal128 })
  appraisalPrice?: StoredMoney | null;

  @Prop({ type: Array })
  phases?: StoredPhase[];

  @Prop({ type: Object })
  currentPhase?: StoredPhase;

  @Prop({ type: String })
  detailsUrl?: string | null;

  @Prop({ type: Object })
  image?: AuctionFile | null;

  @Prop({ type: Object })
  matricula?: AuctionFile | null;

  @Prop({ type: Object })
  edital?: AuctionFile | null;

  @Prop({ type: String })
  description?: string | null;

  @Prop({ type: Boolean, default: false, index: true })
  fulfilled!: boolean;

  @Prop({ type: Boolean, default: true, index: true })
  available!: boolean;

  @Prop({ type: Date, index: true })
  availabilityCheckedAt?: Date;

  @Prop({ index: true })
  updatedAt!: Date;
}

export type AuctionDocument = HydratedDocument<AuctionEntity>;

export const AuctionSchema = SchemaFactory.createForClass(AuctionEntity);

AuctionSchema.index({ 'address.state': 1, 'address.city': 1 });
AuctionSchema.index({ 'address.state': 1, 'address.city': 1, 'address.neighborhood': 1 });
AuctionSchema.index({ 'currentPhase.modality': 1 });
// MongoDB orders numbers across BSON types by value, so this index and the price range filter
// serve Decimal128 and legacy number prices alike during the expand step (AR-28).
AuctionSchema.index({ 'currentPhase.minimumPrice': 1 });
