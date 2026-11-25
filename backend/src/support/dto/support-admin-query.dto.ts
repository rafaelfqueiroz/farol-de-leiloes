import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { SUPPORT_REQUEST_STATUSES, type SupportRequestStatus } from '../domain/support-request.js';

/** GET /api/admin/support-requests (BR-009-12): the page (AR-35) and an optional status. */
export class SupportAdminQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: SUPPORT_REQUEST_STATUSES,
    enumName: 'SupportRequestStatus',
    description: 'Only the requests in this status; all of them when absent',
  })
  @IsOptional()
  @IsIn(SUPPORT_REQUEST_STATUSES)
  status?: SupportRequestStatus;
}
