import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../access/decorators/access-guards.decorator.js';
import { ApiJwtAuth } from '../../auth/decorators/api-jwt-auth.decorator.js';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator.js';
import { ApiPaginatedResponse } from '../../common/pagination/api-paginated-response.decorator.js';
import { mapPage, type Paginated } from '../../common/pagination/paginated.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { ImportRunResponseDto } from './import-run-response.dto.js';
import { ImportRunService } from './import-run.service.js';

/** SPEC-004 BR-004-28: the platform admins' view of the Caixa import. */
@ApiTags('admin')
@ApiErrorResponses()
@Controller('admin/import-runs')
export class ImportRunsController {
  constructor(private readonly runs: ImportRunService) {}

  @Get()
  @ApiJwtAuth()
  @AdminOnly() // SPEC-002 BR-002-23: users.isAdmin; a client sees 403, an anonymous caller 401
  @ApiOperation({
    summary: 'The Import Runs, newest first (admin, paginated; BR-004-27, BR-004-28)',
  })
  @ApiPaginatedResponse(ImportRunResponseDto)
  async findAll(@Query() query: PaginationQueryDto): Promise<Paginated<ImportRunResponseDto>> {
    const page = await this.runs.findPage(query);
    return mapPage(page, (record) => new ImportRunResponseDto(record));
  }
}
