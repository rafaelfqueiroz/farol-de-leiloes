import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FavoritesService } from './favorites.service';
import { AddFavoriteDto } from './dto/add-favorite.dto';
import { FavoriteCodesResponseDto } from './dto/favorite-codes-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { AuctionResponseDto } from '../auctions/dto/auction-response.dto';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { mapPage, type Paginated } from '../common/pagination/paginated';

@ApiTags('favorites')
@ApiErrorResponses()
@ApiJwtAuth()
@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'The signed-in user favorited active auctions (paginated, AR-35)' })
  @ApiPaginatedResponse(AuctionResponseDto)
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<AuctionResponseDto>> {
    const page = await this.favoritesService.findPage(user.userId, query);
    return mapPage(page, (auction) => new AuctionResponseDto(auction));
  }

  @Get('codes')
  @ApiOperation({ summary: 'Codes of every auction the signed-in user favorited' })
  @ApiOkResponse({ type: FavoriteCodesResponseDto })
  async findCodes(@CurrentUser() user: AuthenticatedUser): Promise<FavoriteCodesResponseDto> {
    return new FavoriteCodesResponseDto(await this.favoritesService.findCodes(user.userId));
  }

  @Post()
  @ApiOperation({ summary: 'Favorite an auction (idempotent)' })
  @ApiCreatedResponse({ type: AuctionResponseDto })
  @ApiNotFoundResponse({ description: 'AUCTION_NOT_FOUND', type: ErrorResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddFavoriteDto,
  ): Promise<AuctionResponseDto> {
    const auction = await this.favoritesService.create(user.userId, dto.code);
    return new AuctionResponseDto(auction);
  }

  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an auction from the favorites (idempotent)' })
  @ApiNoContentResponse({ description: 'Removed, or was not a favorite' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string): Promise<void> {
    await this.favoritesService.remove(user.userId, code);
  }
}
