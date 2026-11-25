import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AccessContext } from '../access/access-context.js';
import { AdminOnly } from '../access/decorators/access-guards.decorator.js';
import { Access } from '../access/decorators/access.decorator.js';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator.js';
import { mapPage, type Paginated } from '../common/pagination/paginated.js';
import { SupportAdminQueryDto } from './dto/support-admin-query.dto.js';
import { SupportGrantDto, SupportRequestAdminDetailDto } from './dto/support-admin-response.dto.js';
import { SupportRequestSummaryDto } from './dto/support-request-response.dto.js';
import { SupportAdminService } from './support-admin.service.js';

/**
 * SPEC-009 BR-009-10, BR-009-12: the admin's side of support requests. Every route is `@AdminOnly()`
 * (a non-admin is 403, an anonymous request 401, an admin whose email is not confirmed
 * EMAIL_VERIFICATION_REQUIRED). The admin reads the message addressed to support without a grant; the
 * requester's data in the product is reached ONLY through a grant opened here (BR-002-24), whose reads
 * are `/api/admin/support-grants/:grantId/...` (SPEC-016, SPEC-021). There is no route to write
 * anything but the close below. A malformed, unknown or foreign id is the same NOT_FOUND.
 */
@ApiTags('admin-support')
@ApiErrorResponses()
@ApiJwtAuth()
@Controller('admin/support-requests')
export class SupportAdminController {
  constructor(private readonly support: SupportAdminService) {}

  @Get()
  @AdminOnly()
  @ApiOperation({
    summary: 'The support queue: every account’s requests, newest first (admin, paginated)',
    description: 'Optionally only the open or only the closed ones with `status` (BR-009-12).',
  })
  @ApiPaginatedResponse(SupportRequestSummaryDto)
  async list(
    @Access() admin: AccessContext,
    @Query() query: SupportAdminQueryDto,
  ): Promise<Paginated<SupportRequestSummaryDto>> {
    const page = await this.support.list(admin, query);
    return mapPage(page, (request) => new SupportRequestSummaryDto(request));
  }

  @Get(':id')
  @AdminOnly()
  @ApiOperation({
    summary: 'One support request with its requester, for answering by email (admin)',
    description:
      'Protocol, subject, message (plain text, BR-009-11), the requester’s name and email ' +
      '(BR-009-10), the permission state and the grant THIS admin holds, never another admin’s.',
  })
  @ApiOkResponse({ type: SupportRequestAdminDetailDto })
  @ApiNotFoundResponse({
    description: 'NOT_FOUND: unknown or malformed id',
    type: ErrorResponseDto,
  })
  detail(
    @Access() admin: AccessContext,
    @Param('id') id: string,
  ): Promise<SupportRequestAdminDetailDto> {
    return this.support.detail(admin, id);
  }

  @Post(':id/close')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close a support request, which ends any support access grant tied to it (admin)',
    description:
      'Idempotent: closing a closed request answers it unchanged (BR-009-12, BR-002-26). The team ' +
      'answers by email, outside the product.',
  })
  @ApiOkResponse({ type: SupportRequestAdminDetailDto })
  @ApiNotFoundResponse({
    description: 'NOT_FOUND: unknown or malformed id',
    type: ErrorResponseDto,
  })
  close(
    @Access() admin: AccessContext,
    @Param('id') id: string,
  ): Promise<SupportRequestAdminDetailDto> {
    return this.support.close(admin, id);
  }

  @Post(':id/grant')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Open (or get) this admin’s support access grant on a request (admin)',
    description:
      'Only on an open request whose requester allowed the support team to view their data, and ' +
      'only while that permission stands (BR-009-08, BR-002-24). Idempotent for the same admin. ' +
      'Anything else, including a request whose open grant another admin holds, is the same ' +
      'NOT_FOUND as a request that does not exist. The grant lasts at most 7 days (BR-002-26).',
  })
  @ApiOkResponse({ type: SupportGrantDto })
  @ApiNotFoundResponse({
    description: 'NOT_FOUND: unknown, closed, not permitted, withdrawn or held by another admin',
    type: ErrorResponseDto,
  })
  async openGrant(
    @Access() admin: AccessContext,
    @Param('id') id: string,
  ): Promise<SupportGrantDto> {
    return new SupportGrantDto(await this.support.openGrant(admin, id));
  }
}
