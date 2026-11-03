import type { Paginated } from '@/lib/pagination';

// Auction query parameters interface
export interface AuctionQueryParams {
  state?: string;
  city?: string;
  neighborhood?: string;
  modality?: string;
  minMargin?: number;
  maxMargin?: number;
  // AR-35: pages start at 1; pageSize is at most 100
  page?: number;
  pageSize?: number;
}

// Auction result interface
export interface Auction {
  code: string;
  title: string;
  address: string;
  city: string;
  state: string;
  neighborhood?: string;
  appraisalValue: number;
  minimumBid?: number;
  discount?: number;
  modality: string;
  auctionDate?: string;
  description?: string;
  imageUrl?: string;
}

export type AuctionResult = Paginated<Auction>;
