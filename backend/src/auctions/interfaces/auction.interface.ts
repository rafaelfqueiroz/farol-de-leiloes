import type { Decimal } from '../../common/money/money';
import type { StoredMoney } from '../../common/money/stored-money';
import {
  Address,
  AuctionFile,
  ExpenseRule,
  PaymentMethod,
  PhaseModality,
  StoredPhase,
} from '../schemas/auction.schema';

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
  detailsUrl: string | null;
  imageUrl: string | null;
  matriculaUrl: string | null;
  editalUrl: string | null;
  description: string | null;
  fulfilled: boolean;
  available: boolean;
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
  appraisalPrice?: StoredMoney | null;
  phases?: StoredPhase[];
  currentPhase?: StoredPhase;
  detailsUrl?: string | null;
  image?: AuctionFile | null;
  matricula?: AuctionFile | null;
  description?: string | null;
  fulfilled?: boolean;
  available?: boolean;
  updatedAt: Date;
}
