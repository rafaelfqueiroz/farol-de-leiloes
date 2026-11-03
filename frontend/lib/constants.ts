// Auction query parameters interface
export interface AuctionQueryParams {
  state?: string;
  city?: string;
  neighborhood?: string;
  modality?: string;
  // BRL price bounds (not percentages) as money strings, e.g. "50000.00" (AR-17)
  minMargin?: string;
  maxMargin?: string;
  // AR-35: pages start at 1; pageSize is at most 100
  page?: number;
  pageSize?: number;
}
