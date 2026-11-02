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
import { SavedFiltersService } from './saved-filters.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { SavedFilterResponseDto } from './dto/saved-filter-response.dto';
import { FilterData } from './schemas/saved-filter.schema';

interface CreateSavedFilterDto {
  name: string;
  filters: FilterData;
}

@Controller('saved-filters')
@UseGuards(JwtAuthGuard)
export class SavedFiltersController {
  constructor(private readonly savedFiltersService: SavedFiltersService) {}

  @Get()
  async findAll(@CurrentUser() user: AuthenticatedUser): Promise<SavedFilterResponseDto[]> {
    const filters = await this.savedFiltersService.findAll(user.userId);
    return filters.map((filter) => new SavedFilterResponseDto(filter));
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateSavedFilterDto,
  ): Promise<SavedFilterResponseDto> {
    const filter = await this.savedFiltersService.create(user.userId, body.name, body.filters);
    return new SavedFilterResponseDto(filter);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.savedFiltersService.delete(user.userId, id);
  }
}
