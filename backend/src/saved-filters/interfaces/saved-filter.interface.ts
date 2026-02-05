import { FilterData } from '../schemas/saved-filter.schema';

export interface SavedFilter {
  _id: string;
  name: string;
  filters: FilterData;
  createdAt: Date;
}
