import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import type { AuctionQueryParams } from '../services/nlp.service';
import { MAX_PAGE_SIZE } from '../../common/pagination/pagination-query.dto';

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

  @ApiPropertyOptional({ type: Number, minimum: 0, description: 'BRL' })
  minMargin?: number;

  @ApiPropertyOptional({ type: Number, minimum: 0, description: 'BRL' })
  maxMargin?: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 1 })
  page?: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE })
  pageSize?: number;

  constructor(params: AuctionQueryParams) {
    this.state = params.state;
    this.city = params.city;
    this.neighborhood = params.neighborhood;
    this.modality = params.modality;
    this.minMargin = params.minMargin;
    this.maxMargin = params.maxMargin;
    this.page = params.page;
    this.pageSize = params.pageSize;
  }
}
