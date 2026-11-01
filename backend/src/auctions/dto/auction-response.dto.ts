import { Auction, AuctionListResult } from '../interfaces/auction.interface';

export class AuctionResponseDto {
  code: string;
  title: string | null;
  address: Auction['address'];
  appraisalPrice: number | null;
  phases: Auction['phases'];
  currentPhase: Auction['currentPhase'];
  detailsUrl: string | null;
  imageUrl: string | null;
  matriculaUrl: string | null;
  editalUrl: string | null;
  description: string | null;
  fulfilled: boolean;
  available: boolean;
  updatedAt: Date;

  constructor(auction: Auction) {
    this.code = auction.code;
    this.title = auction.title;
    this.address = auction.address;
    this.appraisalPrice = auction.appraisalPrice;
    this.phases = auction.phases;
    this.currentPhase = auction.currentPhase;
    this.detailsUrl = auction.detailsUrl;
    this.imageUrl = auction.imageUrl;
    this.matriculaUrl = auction.matriculaUrl;
    this.editalUrl = auction.editalUrl;
    this.description = auction.description;
    this.fulfilled = auction.fulfilled;
    this.available = auction.available;
    this.updatedAt = auction.updatedAt;
  }
}

export class AuctionListResponseDto {
  total: number;
  items: AuctionResponseDto[];

  constructor(result: AuctionListResult) {
    this.total = result.total;
    this.items = result.items.map((item) => new AuctionResponseDto(item));
  }
}
