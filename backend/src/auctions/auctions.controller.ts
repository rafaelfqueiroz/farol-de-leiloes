import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { AuctionsService } from './auctions.service';

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  @Get()
  async list(
    @Query('state') state?: string,
    @Query('city') city?: string,
    @Query('neighborhood') neighborhood?: string,
    @Query('modality') modality?: string,
    @Query('minMargin') minMargin?: string,
    @Query('maxMargin') maxMargin?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const take = Math.min(Number(limit) || 10, 200);
    const skip = Number(offset) || 0;
    return this.auctions.query({
      state,
      city,
      neighborhood,
      modality,
      minMargin: minMargin ? Number(minMargin) : undefined,
      maxMargin: maxMargin ? Number(maxMargin) : undefined,
      take,
      skip,
    });
  }

  @Get(':code')
  async getAuction(@Param('code') code: string) {
    const auction = await this.auctions.findByCode(code);
    if (!auction) {
      throw new NotFoundException(`Auction with code ${code} not found`)
    }
    return auction;
  }
}

