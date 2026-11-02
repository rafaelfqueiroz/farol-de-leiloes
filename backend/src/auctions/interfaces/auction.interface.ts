import { Address, AuctionFile, Phase } from '../schemas/auction.schema';

export interface Auction {
  code: string;
  title: string | null;
  address: Address | null;
  appraisalPrice: number | null;
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

export interface AuctionListResult {
  total: number;
  items: Auction[];
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
  appraisalPrice?: number | null;
  phases?: Phase[];
  currentPhase?: Phase;
  detailsUrl?: string | null;
  image?: AuctionFile | null;
  matricula?: AuctionFile | null;
  description?: string | null;
  fulfilled?: boolean;
  available?: boolean;
  updatedAt: Date;
}
