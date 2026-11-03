// The search criteria a saved filter stores: the same filters GET /api/auctions takes, with the
// list filters always as lists. Used for the request (AR-34) and, copied field by field, for the
// response (AR-36).
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { FilterData } from '../schemas/saved-filter.schema';

export class FilterDataDto {
  @ApiPropertyOptional({ type: String, description: 'UF, e.g. SP' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  city?: string[];

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  neighborhood?: string[];

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modality?: string[];

  @ApiPropertyOptional({ type: Number, minimum: 0, description: 'BRL' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minMargin?: number;

  @ApiPropertyOptional({ type: Number, minimum: 0, description: 'BRL' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxMargin?: number;

  static from(filters: FilterData): FilterDataDto {
    const dto = new FilterDataDto();
    dto.state = filters.state;
    dto.city = filters.city;
    dto.neighborhood = filters.neighborhood;
    dto.modality = filters.modality;
    dto.minMargin = filters.minMargin;
    dto.maxMargin = filters.maxMargin;
    return dto;
  }

  /** The plain object stored in the document: only the criteria that were given. */
  toFilterData(): FilterData {
    const data: FilterData = {
      state: this.state,
      city: this.city,
      neighborhood: this.neighborhood,
      modality: this.modality,
      minMargin: this.minMargin,
      maxMargin: this.maxMargin,
    };
    // The driver would store an undefined criterion as null.
    return Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    ) as FilterData;
  }
}
