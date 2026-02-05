import { SavedFilter } from '../interfaces/saved-filter.interface';
import { FilterData } from '../schemas/saved-filter.schema';

export class SavedFilterResponseDto {
  _id: string;
  name: string;
  filters: FilterData;
  createdAt: Date;

  constructor(savedFilter: SavedFilter) {
    this._id = savedFilter._id;
    this.name = savedFilter.name;
    this.filters = savedFilter.filters;
    this.createdAt = savedFilter.createdAt;
  }
}
