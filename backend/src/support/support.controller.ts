import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { AccessContext } from '../access/access-context.js';
import { Access } from '../access/decorators/access.decorator.js';
import { ApiConfirmedEmail } from '../auth/decorators/api-confirmed-email.decorator.js';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { ConfirmedEmailGuard } from '../auth/guards/confirmed-email.guard.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator.js';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto.js';
import { mapPage, type Paginated } from '../common/pagination/paginated.js';
import { CreateSupportRequestDto } from './dto/create-support-request.dto.js';
import {
  CreateSupportRequestResponseDto,
  SupportRequestResponseDto,
  SupportRequestSummaryDto,
} from './dto/support-request-response.dto.js';
import { SupportService } from './support.service.js';
import { SupportAccountThrottlerGuard } from './support-throttler.module.js';

/**
 * SPEC-009 BR-009-04..BR-009-09: the requester's side of support requests. Every route acts on the
 * AUTHENTICATED account: its id comes from the session, never from the path, the query or the body
 * (BR-002-11; a body naming a `userId` is refused by the whitelist), and another account's request id
 * is the same 404 as a missing or malformed one (AR-14).
 */
@ApiTags('support')
@ApiErrorResponses()
@ApiJwtAuth()
@ApiConfirmedEmail()
@UseGuards(ConfirmedEmailGuard) // BR-001-04: server-side, not only the frontend banner
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @UseGuards(SupportAccountThrottlerGuard) // SC-04: 5 an hour per account
  @ApiOperation({
    summary: 'Open a support request (stored with a protocol; confirmed by email)',
    description:
      'Needs a confirmed email (BR-009-04). Stores the request with a protocol `FL-YYYY-NNNNNN` ' +
      '(BR-009-06), sends the confirmation to the account and the notice to the support team, and ' +
      'answers at once: if sending fails the request is still stored, `confirmationSent` is false ' +
      'and the email is retried (BR-009-07). `allowDataAccess` (default false) lets the support team ' +
      'view the data in the product needed to solve the request until the requester withdraws it ' +
      '(BR-009-08).',
  })
  @ApiCreatedResponse({ type: CreateSupportRequestResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
  async create(
    @Access() access: AccessContext,
    @Body() dto: CreateSupportRequestDto,
  ): Promise<CreateSupportRequestResponseDto> {
    const { request, confirmationSent } = await this.support.create(access, dto);
    return new CreateSupportRequestResponseDto(request, confirmationSent);
  }

  @Get('mine')
  @ApiOperation({ summary: 'The signed-in account’s own support requests, newest first (AR-35)' })
  @ApiPaginatedResponse(SupportRequestSummaryDto)
  async listMine(
    @Access() access: AccessContext,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<SupportRequestSummaryDto>> {
    const page = await this.support.listMine(access, query);
    return mapPage(page, (request) => new SupportRequestSummaryDto(request));
  }

  @Get('mine/:id')
  @ApiOperation({ summary: 'One of the signed-in account’s own support requests' })
  @ApiOkResponse({ type: SupportRequestResponseDto })
  @ApiNotFoundResponse({
    description: 'NOT_FOUND: not the account’s, missing and malformed ids alike (AR-14)',
    type: ErrorResponseDto,
  })
  async getMine(
    @Access() access: AccessContext,
    @Param('id') id: string,
  ): Promise<SupportRequestResponseDto> {
    return new SupportRequestResponseDto(await this.support.getMine(access, id));
  }

  @Post('mine/:id/withdraw-data-access')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Withdraw the permission for the support team to view the account’s data',
    description:
      'Ends any support access grant of this request at once (BR-009-08, BR-002-26). Idempotent: ' +
      'asking again, or on a request that never had the permission, answers the unchanged request. ' +
      'A closed request answers SUPPORT_REQUEST_CLOSED (409).',
  })
  @ApiOkResponse({ type: SupportRequestResponseDto })
  @ApiNotFoundResponse({
    description: 'NOT_FOUND: not the account’s, missing and malformed ids alike (AR-14)',
    type: ErrorResponseDto,
  })
  async withdrawDataAccess(
    @Access() access: AccessContext,
    @Param('id') id: string,
  ): Promise<SupportRequestResponseDto> {
    return new SupportRequestResponseDto(await this.support.withdrawDataAccess(access, id));
  }
}
