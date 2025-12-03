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
      this.logger.log(`GET - User: ${JSON.stringify(user)}`);
      const result = await this.favoritesService.findAll(user.userId);
      this.logger.log(`GET - Success, count: ${result.length}`);
      return result;
    } catch (error: any) {
      this.logger.error(`GET - Error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post()
  async create(@CurrentUser() user: any, @Body() auctionData: any) {
    try {
      this.logger.log(`POST - User: ${JSON.stringify(user)}`);
      this.logger.log(`POST - Auction data: ${JSON.stringify(auctionData)}`);
      const auctionCode = auctionData.code;
      const result = await this.favoritesService.create(user.userId, auctionCode);
      this.logger.log('POST - Success');
      return result;
    } catch (error: any) {
      this.logger.error(`POST - Error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: any, @Param('code') code: string) {
    try {
      this.logger.log(`DELETE - User: ${JSON.stringify(user)}`);
      this.logger.log(`DELETE - Code: ${code}`);
      await this.favoritesService.remove(user.userId, code);
      this.logger.log('DELETE - Success');
    } catch (error: any) {
      this.logger.error(`DELETE - Error: ${error.message}`, error.stack);
      throw error;
    }
  }
}
