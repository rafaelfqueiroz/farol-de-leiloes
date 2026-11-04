import type { Decimal } from '../../common/money/money';

/** A saved filter's criteria in code: the price bounds are reais as Decimal (AR-17). */
export interface FilterData {
  state?: string;
  city?: string[];
  neighborhood?: string[];
  modality?: string[];
  minPrice?: Decimal;
  maxPrice?: Decimal;
}

export interface SavedFilter {
  _id: string;
  name: string;
  filters: FilterData;
  createdAt: Date;
}
