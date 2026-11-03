// The search criteria a saved filter stores: the same filters GET /api/auctions takes, with the
// list filters always as lists. FilterDataDto is the request (AR-34); FilterDataResponseDto the
// response, each field copied explicitly (AR-36). Money is a string over JSON both ways (AR-17).
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import type { Decimal } from '../../common/money/money';
import { IsMoneyString, MONEY_API_PROPERTY, moneyToJson } from '../../common/money/money-dto';
import { FilterData } from '../interfaces/saved-filter.interface';

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

  // Prices in reais, despite the name: the bounds of GET /api/auctions' minMargin/maxMargin.
  @ApiPropertyOptional({ ...MONEY_API_PROPERTY, description: 'Lowest minimum price, BRL' })
  @IsOptional()
  @IsMoneyString()
  minMargin?: Decimal;

  @ApiPropertyOptional({ ...MONEY_API_PROPERTY, description: 'Highest minimum price, BRL' })
  @IsOptional()
  @IsMoneyString()
  maxMargin?: Decimal;

  /**
   * Only the criteria that were given: the driver would store an undefined one as null, and
   * @IsOptional lets an explicit null through, which means the same as absent.
   */
  toFilterData(): FilterData {
    const data: FilterData = {
      state: this.state,
      city: this.city,
      neighborhood: this.neighborhood,
      modality: this.modality,
      minMargin: this.minMargin,
      maxMargin: this.maxMargin,
    };
    return Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined && value !== null),
    ) as FilterData;
  }
}

export class FilterDataResponseDto {
  @ApiPropertyOptional({ type: String, description: 'UF, e.g. SP' })
  state?: string;

  @ApiPropertyOptional({ type: String, isArray: true })
  city?: string[];

  @ApiPropertyOptional({ type: String, isArray: true })
  neighborhood?: string[];

  @ApiPropertyOptional({ type: String, isArray: true })
  modality?: string[];

  @ApiPropertyOptional({ ...MONEY_API_PROPERTY, description: 'Lowest minimum price, BRL' })
  minMargin?: string;

  @ApiPropertyOptional({ ...MONEY_API_PROPERTY, description: 'Highest minimum price, BRL' })
  maxMargin?: string;

  constructor(filters: FilterData) {
    this.state = filters.state;
    this.city = filters.city;
    this.neighborhood = filters.neighborhood;
    this.modality = filters.modality;
    this.minMargin = moneyToJson(filters.minMargin);
    this.maxMargin = moneyToJson(filters.maxMargin);
  }
}
