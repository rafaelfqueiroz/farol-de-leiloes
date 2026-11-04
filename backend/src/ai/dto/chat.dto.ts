import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import type { AuctionQueryParams } from '../services/nlp.service';
import { MAX_PAGE_SIZE } from '../../common/pagination/pagination-query.dto';
import { MONEY_API_PROPERTY, moneyToJson } from '../../common/money/money-dto';

export class ChatRequestDto {
  @ApiProperty({ type: String, description: 'The search, in the user own words (pt-BR)' })
  @IsString()
  @IsNotEmpty()
  message!: string;
}

/**
 * The search parameters understood from the message, ready for GET /api/auctions: every field
 * is optional and absent when the message did not mention it. Paging follows AR-35.
 */
export class ChatResponseDto {
  @ApiPropertyOptional({ type: String, description: 'UF, e.g. SP' })
  state?: string;

  @ApiPropertyOptional({ type: String })
  city?: string;

  @ApiPropertyOptional({ type: String })
  neighborhood?: string;

  @ApiPropertyOptional({ type: String, description: 'Phase modality, e.g. SFI_AUCTION' })
  modality?: string;

  // AR-17: price bounds in reais, as strings; pass them to GET /api/auctions unchanged.
  @ApiPropertyOptional({ ...MONEY_API_PROPERTY, description: 'Lowest minimum price, BRL' })
  minPrice?: string;

  @ApiPropertyOptional({ ...MONEY_API_PROPERTY, description: 'Highest minimum price, BRL' })
  maxPrice?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1 })
  page?: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE })
  pageSize?: number;

  constructor(params: AuctionQueryParams) {
    this.state = params.state;
    this.city = params.city;
    this.neighborhood = params.neighborhood;
    this.modality = params.modality;
    this.minPrice = moneyToJson(params.minPrice);
    this.maxPrice = moneyToJson(params.maxPrice);
    this.page = params.page;
    this.pageSize = params.pageSize;
  }
}
