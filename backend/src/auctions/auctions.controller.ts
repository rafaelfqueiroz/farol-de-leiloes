import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { AuctionsService } from './auctions.service';
import { AuctionResponseDto, AuctionListResponseDto } from './dto/auction-response.dto';

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  @Get()
  async list(
    @Query('state') state?: string,
    @Query('city') city?: string | string[],
    @Query('neighborhood') neighborhood?: string | string[],
    @Query('modality') modality?: string | string[],
    @Query('minMargin') minMargin?: string,
    @Query('maxMargin') maxMargin?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AuctionListResponseDto> {
    const take = Math.min(Number(limit) || 10, 200);
    const skip = Number(offset) || 0;

    // Parse comma-separated values into arrays
    const parseMultiple = (value: string | string[] | undefined): string | string[] | undefined => {
      if (!value) return undefined;
      if (Array.isArray(value)) return value;
      if (value.includes(',')) return value.split(',').map(v => v.trim());
      return value;
    };

    const result = await this.auctions.query({
      state,
      city: parseMultiple(city),
      neighborhood: parseMultiple(neighborhood),
      modality: parseMultiple(modality),
      minMargin: minMargin ? Number(minMargin) : undefined,
      maxMargin: maxMargin ? Number(maxMargin) : undefined,
      take,
      skip,
    });

    return new AuctionListResponseDto(result);
  }

  @Get('neighborhoods')
  async getNeighborhoods(
    @Query('state') state?: string,
    @Query('city') city?: string | string[],
  ) {
    if (!state) {
      throw new BadRequestException('State is required');
    }
    if (!city) {
      throw new BadRequestException('City is required');
    }

    // Parse comma-separated values into arrays
    const cities = Array.isArray(city)
      ? city
      : city.includes(',')
        ? city.split(',').map(c => c.trim())
        : [city];

    const neighborhoods = await this.auctions.getNeighborhoods(state, cities);
    return { neighborhoods };
  }

  @Get('sitemap/codes')
  async getSitemapCodes() {
    const codes = await this.auctions.getAllCodes();
    return { codes };
  }

  @Get(':code')
  async getAuction(@Param('code') code: string): Promise<AuctionResponseDto> {
    const auction = await this.auctions.findByCode(code);
    if (!auction) {
      throw new NotFoundException(`Auction with code ${code} not found`)
    }
    return new AuctionResponseDto(auction);
  }
}
