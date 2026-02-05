import { Address, Phase } from '../schemas/auction.schema';

export interface Auction {
  code: string;
  title: string | null;
  address: Address | null;
  appraisalPrice: number | null;
  phases: Phase[];
  detailsUrl: string | null;
  imageUrl: string | null;
  description: string | null;
  fulfilled: boolean;
  available: boolean;
  updatedAt: Date;
}

export interface AuctionListResult {
  total: number;
  items: Auction[];
}
