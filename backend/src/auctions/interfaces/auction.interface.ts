import type { Types } from 'mongoose';
import type { Decimal } from '../../common/money/money.js';
import type { Round } from '../domain/rounds.js';
import {
  Address,
  AuctionFile,
  ExpenseRule,
  PaymentMethod,
  PhaseModality,
  Occupancy,
  StoredPhase,
  StoredRound,
} from '../schemas/auction.schema.js';

/** A phase in code: money as a Decimal (AR-17). Stored as a StoredPhase. */
export interface Phase {
  modality: PhaseModality;
  /** Reais; null when Caixa gave no price. */
  minimumPrice: Decimal | null;
  phaseDates?: Date[];
  paymentMethods?: PaymentMethod[];
  expenseRules?: ExpenseRule[];
}

export interface Auction {
  code: string;
  title: string | null;
  address: Address | null;
  /** Reais (AR-17). */
  appraisalPrice: Decimal | null;
  phases: Phase[];
  currentPhase: Phase | null;
  /** BR-004-11: null = unknown (BR-004-15). */
  propertyType: string | null;
  /** BR-004-13: empty = not collected yet = unknown (BR-004-15), never a default. */
  rounds: Round[];
  /** BR-004-11: null = unknown, never "unoccupied" by default (BR-004-15). */
  occupancy: Occupancy | null;
  /** When a validated list last contained it; null before the first apply under SPEC-004. */
  listSeenAt: Date | null;
  /** When its detail page was last collected; null = never. */
  detailsCollectedAt: Date | null;
  detailsUrl: string | null;
  imageUrl: string | null;
  matriculaUrl: string | null;
  editalUrl: string | null;
  description: string | null;
  fulfilled: boolean;
  /** Marked available by the last applied list (BR-004-08). */
  available: boolean;
  /** BR-004-16: available and not past its last round, at the read's "now" (domain/active.ts). */
  active: boolean;
  /** BR-004-13: the current round's price, or the list price when none is known; reais (AR-17). */
  currentMinimumPrice: Decimal | null;
  /** BR-004-14: percent, computed at read time, never clamped; null when a figure is unknown. */
  discountPercent: Decimal | null;
  updatedAt: Date;
}

/**
 * The stored fields an `Auction` is built from: a lean or hydrated auction record, or one
 * populated into another module's document. Lets those modules type it without importing the
 * auction schema (AR-09).
 */
export interface AuctionRecord {
  code: string;
  title?: string | null;
  address?: Address;
  appraisalPrice?: Types.Decimal128 | null;
  phases?: StoredPhase[];
  currentPhase?: StoredPhase;
  propertyType?: string | null;
  rounds?: StoredRound[] | null;
  occupancy?: Occupancy | null;
  listSeenAt?: Date | null;
  detailsCollectedAt?: Date | null;
  detailsUrl?: string | null;
  image?: AuctionFile | null;
  matricula?: AuctionFile | null;
  description?: string | null;
  fulfilled?: boolean;
  available?: boolean;
  updatedAt: Date;
}
