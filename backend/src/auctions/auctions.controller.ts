import { Public } from '../auth/decorators/public.decorator';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuctionsService } from './auctions.service';
import { AuctionResponseDto } from './dto/auction-response.dto';
import { ListAuctionsQueryDto, NeighborhoodsQueryDto } from './dto/auction-query.dto';
import {
  NeighborhoodsResponseDto,
  SitemapCodesResponseDto,
} from './dto/auction-lookup-response.dto';
import { DomainError } from '../common/errors/domain-error';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { mapPage, type Paginated } from '../common/pagination/paginated';

@ApiTags('auctions')
@ApiErrorResponses()
@Public()
@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  @Get()
  @ApiOperation({ summary: 'Search active auctions (paginated, AR-35)' })
  @ApiPaginatedResponse(AuctionResponseDto)
  async list(@Query() query: ListAuctionsQueryDto): Promise<Paginated<AuctionResponseDto>> {
    const { page, pageSize, ...filters } = query;
    const result = await this.auctions.query(filters, { page, pageSize });
    return mapPage(result, (auction) => new AuctionResponseDto(auction));
  }

  // AR-35 exemption (ARCHITECTURE §8): a lookup of a filter's options, needed whole.
  @Get('neighborhoods')
  @ApiOperation({ summary: 'Distinct neighborhoods of active auctions in a state and cities' })
  @ApiOkResponse({ type: NeighborhoodsResponseDto })
  async getNeighborhoods(@Query() query: NeighborhoodsQueryDto): Promise<NeighborhoodsResponseDto> {
    const neighborhoods = await this.auctions.getNeighborhoods(query.state, query.city);
    return new NeighborhoodsResponseDto(neighborhoods);
  }

  // AR-35 exemption (ARCHITECTURE §8): the sitemap lists every active auction by definition.
  @Get('sitemap/codes')
  @ApiOperation({ summary: 'Codes of every active auction, for the sitemap' })
  @ApiOkResponse({ type: SitemapCodesResponseDto })
  async getSitemapCodes(): Promise<SitemapCodesResponseDto> {
    const codes = await this.auctions.getAllCodes();
    return new SitemapCodesResponseDto(codes);
  }

  @Get(':code')
  @ApiOperation({ summary: 'One available auction by its Caixa code' })
  @ApiOkResponse({ type: AuctionResponseDto })
  @ApiNotFoundResponse({ description: 'AUCTION_NOT_FOUND', type: ErrorResponseDto })
  async getAuction(@Param('code') code: string): Promise<AuctionResponseDto> {
    const auction = await this.auctions.findByCode(code);
    if (!auction) {
      throw new DomainError('AUCTION_NOT_FOUND');
    }
    return new AuctionResponseDto(auction);
  }
}
