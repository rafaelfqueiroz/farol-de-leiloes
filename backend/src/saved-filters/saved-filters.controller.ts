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
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SavedFiltersService } from './saved-filters.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface.js';
import { SavedFilterResponseDto } from './dto/saved-filter-response.dto.js';
import { CreateSavedFilterDto } from './dto/create-saved-filter.dto.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator.js';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto.js';
import { mapPage, type Paginated } from '../common/pagination/paginated.js';

@ApiTags('saved-filters')
@ApiErrorResponses()
@ApiJwtAuth()
@Controller('saved-filters')
export class SavedFiltersController {
  constructor(private readonly savedFiltersService: SavedFiltersService) {}

  @Get()
  @ApiOperation({ summary: 'The signed-in user saved filters, newest first (paginated, AR-35)' })
  @ApiPaginatedResponse(SavedFilterResponseDto)
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<SavedFilterResponseDto>> {
    const page = await this.savedFiltersService.findPage(user.userId, query);
    return mapPage(page, (filter) => new SavedFilterResponseDto(filter));
  }

  @Post()
  @ApiOperation({ summary: 'Save the current search filters under a name' })
  @ApiCreatedResponse({ type: SavedFilterResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateSavedFilterDto,
  ): Promise<SavedFilterResponseDto> {
    const filter = await this.savedFiltersService.create(
      user.userId,
      body.name,
      body.filters.toFilterData(),
    );
    return new SavedFilterResponseDto(filter);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a saved filter' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'SAVED_FILTER_NOT_FOUND', type: ErrorResponseDto })
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.savedFiltersService.delete(user.userId, id);
  }
}
