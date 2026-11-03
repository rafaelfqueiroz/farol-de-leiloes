// AR-36: a saved filter leaves the API through this class, each field copied explicitly.
import { ApiProperty } from '@nestjs/swagger';
import { SavedFilter } from '../interfaces/saved-filter.interface';
import { FilterDataDto } from './filter-data.dto';

export class SavedFilterResponseDto {
  @ApiProperty({ type: String })
  _id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: () => FilterDataDto })
  filters: FilterDataDto;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  constructor(savedFilter: SavedFilter) {
    this._id = savedFilter._id;
    this.name = savedFilter.name;
    this.filters = FilterDataDto.from(savedFilter.filters);
    this.createdAt = savedFilter.createdAt;
  }
}
