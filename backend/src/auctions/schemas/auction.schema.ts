import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';

// The enum lives in domain/ (AR-05: no framework import there); re-exported for this module.
export { PhaseModality } from '../domain/modality.js';
import type { PhaseModality } from '../domain/modality.js';
export { PaymentMethod } from '../domain/detail-data.js';
export type { ExpenseRule, Occupancy } from '../domain/detail-data.js';
import type { ExpenseRule, Occupancy, PaymentMethod } from '../domain/detail-data.js';

export interface Address {
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipcode?: string;
}

export interface AuctionFile {
  originalUrl: string; // Caixa URL (kept for reference/fallback)
  storageKey?: string; // R2 object key (for signed URL generation)
  publicUrl?: string; // R2 public URL (public catalogue files only: never a private one, SC-18)
  mimeType: string; // e.g., 'image/jpeg', 'application/pdf'
  size?: number; // File size in bytes
  uploadedAt?: Date; // When uploaded to R2
  /** SHA-256 (hex) of the stored bytes (SPEC-004 BR-004-30); the key carries a prefix of it. */
  contentHash?: string;
}

/**
 * SPEC-004 BR-004-30: one stored version of a property's edital or matrícula. Append-only: a new
 * file never replaces an earlier one, which stays stored (DL-004-10).
 */
export interface StoredDocumentVersion {
  kind: 'MATRICULA' | 'EDITAL';
  file: AuctionFile;
  sourceUrl: string;
  contentHash: string;
  retrievedAt: Date;
  /** When the file was last compared with Caixa's (equal to `retrievedAt` until a re-check). */
  checkedAt: Date;
  /** "Edital publicado em", where Caixa shows it. */
  publishedAt: Date | null;
}

/**
 * A phase as stored. `phases` and `currentPhase` are Mixed paths, so Mongoose casts nothing in
 * them: every writer converts through toStoredPhase (auction.mapper.ts) and every reader through
 * fromStoredPhase. In code a phase is the `Phase` of interfaces/auction.interface.ts.
 */
export interface StoredPhase {
  modality: PhaseModality;
  // AR-17: reais as Decimal128; null when Caixa gave no price.
  minimumPrice?: Types.Decimal128 | null;
  phaseDates?: Date[];
  paymentMethods?: PaymentMethod[];
  expenseRules?: ExpenseRule[];
}

/** A sale round as stored (SPEC-004 BR-004-13). Money as Decimal128 (AR-17). */
export interface StoredRound {
  label: string;
  minimumPrice: Types.Decimal128 | null;
  /** The instant the round ends; null = open-ended. */
  date: Date | null;
}

const RoundSchema = new MongooseSchema<StoredRound>(
  {
    label: { type: String, required: true },
    minimumPrice: { type: MongooseSchema.Types.Decimal128, default: null },
    date: { type: Date, default: null },
  },
  { _id: false },
);

@Schema({ collection: 'auctions', timestamps: { createdAt: true, updatedAt: false } })
export class AuctionEntity {
  @Prop({ index: true, unique: true })
  code!: string;

  @Prop({ type: String })
  title?: string | null;

  @Prop({ type: Object })
  address?: Address;

  // AR-17: reais as Decimal128.
  @Prop({ type: MongooseSchema.Types.Decimal128 })
  appraisalPrice?: Types.Decimal128 | null;

  @Prop({ type: Array })
  phases?: StoredPhase[];

  @Prop({ type: Object })
  currentPhase?: StoredPhase;

  @Prop({ type: String })
  detailsUrl?: string | null;

  /** BR-004-11: the detail page's value, the list's description as fallback; null = unknown. */
  @Prop({ type: String, default: null })
  propertyType?: string | null;

  /**
   * BR-004-13: the sale rounds. Empty or absent = not collected yet = UNKNOWN (BR-004-15), never
   * defaulted to anything. Written by the detail collection, never by the list.
   */
  @Prop({ type: [RoundSchema], default: undefined })
  rounds?: StoredRound[];

  /** BR-004-11: null = unknown (not collected), never "unoccupied" by default (BR-004-15). */
  @Prop({ type: String, enum: ['OCCUPIED', 'UNOCCUPIED'], default: null })
  occupancy?: Occupancy | null;

  /** The Import Run whose list last contained this property (BR-004-08: absence is read from it). */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  lastSeenRunId?: Types.ObjectId;

  /** When a validated list last contained it. */
  @Prop({ type: Date })
  listSeenAt?: Date;

  /** The Import Run that last changed a list field of it (BR-004-27's "changed" count). */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  lastChangedRunId?: Types.ObjectId;

  /** When its detail page was last collected; null = never (drives the rolling refresh). */
  @Prop({ type: Date, default: null })
  detailsCollectedAt?: Date | null;

  /** BR-004-11: null / absent = unknown (the page was not collected, or does not say). */
  @Prop({ type: [String], default: undefined })
  paymentMethods?: PaymentMethod[] | null;

  @Prop({ type: Array, default: undefined })
  expenseRules?: ExpenseRule[] | null;

  /** The first photo of the gallery (kept for readers of the single image). */
  @Prop({ type: Object })
  image?: AuctionFile | null;

  /** BR-004-22: our copies of the gallery photos, in page order; absent = not collected. */
  @Prop({ type: Array, default: undefined })
  photos?: AuctionFile[];

  /** The CURRENT matrícula (BR-004-30); a copy kept under `private/` (SC-18), never a public URL. */
  @Prop({ type: Object })
  matricula?: AuctionFile | null;

  /** The CURRENT edital (BR-004-30). */
  @Prop({ type: Object })
  edital?: AuctionFile | null;

  /** BR-004-30: every version of the edital and the matrícula ever stored, oldest first. */
  @Prop({ type: Array, default: undefined })
  documentVersions?: StoredDocumentVersion[];

  /** BR-004-21: page failures in a row; 0 after a successful collection. */
  @Prop({ type: Number, default: 0 })
  detailsFailures!: number;

  /** BR-004-21: a failed page is not asked for again before this instant; null = not waiting. */
  @Prop({ type: Date, default: null })
  detailsRetryAfter?: Date | null;

  /**
   * BR-004-13, BR-004-26: the label of the round that was current when the property was last
   * looked at, by the collection or the clock; null = none was; absent = never recorded. What the
   * clock compares the round of the day with.
   */
  @Prop({ type: String, default: undefined })
  currentRoundLabel?: string | null;

  @Prop({ type: String })
  description?: string | null;

  @Prop({ type: Boolean, default: false, index: true })
  fulfilled!: boolean;

  @Prop({ type: Boolean, default: true, index: true })
  available!: boolean;

  /** Legacy (verifyAvailability, removed by BR-004-08): no longer written; dropped in a contract step. */
  @Prop({ type: Date, index: true })
  availabilityCheckedAt?: Date;

  @Prop({ index: true })
  updatedAt!: Date;
}

export type AuctionDocument = HydratedDocument<AuctionEntity>;

export const AuctionSchema = SchemaFactory.createForClass(AuctionEntity);

// AR-16 / TS-14: the isolation class of this collection.
markIsolation(AuctionSchema, {
  kind: 'public',
  reason: 'The public Caixa catalogue (SPEC-004/005): the same for every visitor',
});

AuctionSchema.index({ 'address.state': 1, 'address.city': 1 });
AuctionSchema.index({ 'address.state': 1, 'address.city': 1, 'address.neighborhood': 1 });
AuctionSchema.index({ 'currentPhase.modality': 1 });
// The price range filter compares Decimal128 bounds with Decimal128 prices (AR-17).
AuctionSchema.index({ 'currentPhase.minimumPrice': 1 });

// SPEC-004 AR-27 / AR-29: built in production by migration 0012-auction-import-model, whose unit
// spec holds these equal to the migration's index specs.
AuctionSchema.index({ available: 1, 'rounds.date': 1 }); // the active predicate (BR-004-16)
AuctionSchema.index({ available: 1, detailsCollectedAt: 1 }); // the rolling refresh (BR-004-19)
AuctionSchema.index({ propertyType: 1 });
AuctionSchema.index({ lastSeenRunId: 1, available: 1 }); // absence from the list (BR-004-08)
AuctionSchema.index({ lastChangedRunId: 1 }); // the run's "changed" count (BR-004-27)
