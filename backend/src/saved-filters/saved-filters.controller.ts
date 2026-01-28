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
  async findAll(@CurrentUser() user: any) {
    return this.savedFiltersService.findAll(user.userId);
  }

  @Post()
  async create(
    @CurrentUser() user: any,
    @Body() body: CreateSavedFilterDto,
  ) {
    return this.savedFiltersService.create(user.userId, body.name, body.filters);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: any, @Param('id') id: string) {
    await this.savedFiltersService.delete(user.userId, id);
  }
}
