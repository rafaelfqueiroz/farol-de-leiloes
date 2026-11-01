import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { AuctionResponseDto } from '../auctions/dto/auction-response.dto';

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  async findAll(@CurrentUser() user: AuthenticatedUser): Promise<AuctionResponseDto[]> {
    const auctions = await this.favoritesService.findAll(user.userId);
    return auctions.map((auction) => new AuctionResponseDto(auction));
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() auctionData: { code: string },
  ): Promise<AuctionResponseDto> {
    const auction = await this.favoritesService.create(user.userId, auctionData.code);
    return new AuctionResponseDto(auction);
  }

  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string) {
    await this.favoritesService.remove(user.userId, code);
  }
}
