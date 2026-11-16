import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthenticatedUser } from '../auth/interfaces/auth.interface.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator.js';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto.js';
import { mapPage, type Paginated } from '../common/pagination/paginated.js';
import { CreateMaintenanceWindowDto } from './dto/create-maintenance-window.dto.js';
import {
  MaintenanceWindowResponseDto,
  UpcomingMaintenanceResponseDto,
} from './dto/maintenance-response.dto.js';
import { MaintenanceService } from './maintenance.service.js';

const ADMIN_ONLY = {
  description: 'FORBIDDEN or PLAN_NOT_ALLOWED: admins only',
  type: ErrorResponseDto,
};

/** SPEC-003 BR-003-03: scheduled maintenance announced inside the product. */
@ApiTags('maintenance')
@ApiErrorResponses()
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  // SC-07: explicitly public. The banner shows to anonymous visitors too. It carries no
  // createdBy and no account data (AR-36). The service reuses its answer for 30 s, and the
  // header lets Next.js and browsers do the same.
  @Public()
  @Get('upcoming')
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({
    summary: 'Maintenance in progress or starting within 14 days, for the announcement banner',
  })
  @ApiOkResponse({ type: UpcomingMaintenanceResponseDto })
  async upcoming(): Promise<UpcomingMaintenanceResponseDto> {
    return new UpcomingMaintenanceResponseDto(await this.maintenance.upcoming());
  }

  @Get()
  @ApiJwtAuth()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Every maintenance window, newest start first (admin, paginated)' })
  @ApiPaginatedResponse(MaintenanceWindowResponseDto)
  @ApiForbiddenResponse(ADMIN_ONLY)
  async findAll(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<MaintenanceWindowResponseDto>> {
    const page = await this.maintenance.findPage(query);
    return mapPage(page, (record) => new MaintenanceWindowResponseDto(record));
  }

  @Post()
  @ApiJwtAuth()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary:
      'Announce a maintenance window (admin). Less than 48 h notice is accepted but ' +
      'announcedInTime is false and it counts as downtime (BR-003-03)',
  })
  @ApiCreatedResponse({ type: MaintenanceWindowResponseDto })
  @ApiForbiddenResponse(ADMIN_ONLY)
  async create(
    @Body() dto: CreateMaintenanceWindowDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MaintenanceWindowResponseDto> {
    return new MaintenanceWindowResponseDto(await this.maintenance.create(dto, admin.userId));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiJwtAuth()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Cancel a maintenance window that has not started (admin)' })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiForbiddenResponse(ADMIN_ONLY)
  @ApiNotFoundResponse({ description: 'MAINTENANCE_WINDOW_NOT_FOUND', type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'MAINTENANCE_WINDOW_ALREADY_STARTED',
    type: ErrorResponseDto,
  })
  async remove(@Param('id') id: string): Promise<void> {
    await this.maintenance.remove(id);
  }
}
