// Auction query parameters interface
export interface AuctionQueryParams {
  state?: string;
  city?: string;
  neighborhood?: string;
  modality?: string;
  minMargin?: number;
  maxMargin?: number;
  limit?: number;
  offset?: number;
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

export interface AuctionResult {
  total: number;
  items: Auction[];
}

// API URL
export const AUCTIONS_API_URL =
  process.env.AUCTIONS_API_URL ||
  process.env.NEXT_PUBLIC_AUCTIONS_API_URL ||
  'http://localhost:3000';
