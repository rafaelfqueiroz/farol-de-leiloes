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
  Logger,
} from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  private readonly logger = new Logger(FavoritesController.name);

  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  async findAll(@CurrentUser() user: any) {
    try {
      const result = await this.favoritesService.findAll(user.userId);
      return result;
    } catch (error: any) {
      throw error;
    }
  }

  @Post()
  async create(@CurrentUser() user: any, @Body() auctionData: any) {
    try {
      const auctionCode = auctionData.code;
      const result = await this.favoritesService.create(user.userId, auctionCode);
      return result;
    } catch (error: any) {
      throw error;
    }
  }

  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: any, @Param('code') code: string) {
    try {
      await this.favoritesService.remove(user.userId, code);
    } catch (error: any) {
      throw error;
    }
  }
}
