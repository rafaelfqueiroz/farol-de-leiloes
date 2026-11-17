import {
  Controller,
  UseGuards,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FavoritesService } from './favorites.service.js';
import { AddFavoriteDto } from './dto/add-favorite.dto.js';
import { FavoriteCodesResponseDto } from './dto/favorite-codes-response.dto.js';
import type { AccessContext } from '../access/access-context.js';
import { Access } from '../access/decorators/access.decorator.js';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { ApiConfirmedEmail } from '../auth/decorators/api-confirmed-email.decorator.js';
import { ConfirmedEmailGuard } from '../auth/guards/confirmed-email.guard.js';
import { AuctionResponseDto } from '../auctions/dto/auction-response.dto.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator.js';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto.js';
import { mapPage, type Paginated } from '../common/pagination/paginated.js';

@ApiTags('favorites')
@ApiErrorResponses()
@ApiJwtAuth()
@ApiConfirmedEmail()
@UseGuards(ConfirmedEmailGuard) // BR-001-04: server-side, not only the frontend banner
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'The signed-in user favorited active auctions (paginated, AR-35)' })
  @ApiPaginatedResponse(AuctionResponseDto)
  async findAll(
    @Access() access: AccessContext,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<AuctionResponseDto>> {
    const page = await this.favoritesService.findPage(access, query);
    return mapPage(page, (auction) => new AuctionResponseDto(auction));
  }

  // BR-001-04: like the rest of this controller, 403 EMAIL_VERIFICATION_REQUIRED while the email is
  // unconfirmed; the frontend answers with the global confirm-your-email banner.
  @Get('codes')
  @ApiOperation({ summary: 'Codes of every auction the signed-in user favorited' })
  @ApiOkResponse({ type: FavoriteCodesResponseDto })
  async findCodes(@Access() access: AccessContext): Promise<FavoriteCodesResponseDto> {
    return new FavoriteCodesResponseDto(await this.favoritesService.findCodes(access));
  }

  @Post()
  @ApiOperation({ summary: 'Favorite an auction (idempotent)' })
  @ApiCreatedResponse({ type: AuctionResponseDto })
  @ApiNotFoundResponse({ description: 'AUCTION_NOT_FOUND', type: ErrorResponseDto })
  async create(
    @Access() access: AccessContext,
    @Body() dto: AddFavoriteDto,
  ): Promise<AuctionResponseDto> {
    const auction = await this.favoritesService.create(access, dto.code);
    return new AuctionResponseDto(auction);
  }

  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an auction from the favorites (idempotent)' })
  @ApiNoContentResponse({ description: 'Removed, or was not a favorite' })
  async remove(@Access() access: AccessContext, @Param('code') code: string): Promise<void> {
    await this.favoritesService.remove(access, code);
  }
}
