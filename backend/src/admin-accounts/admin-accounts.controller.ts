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
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { AccessContext } from '../access/access-context.js';
import { AdminOnly } from '../access/decorators/access-guards.decorator.js';
import { Access } from '../access/decorators/access.decorator.js';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator.js';
import { mapPage, type Paginated } from '../common/pagination/paginated.js';
import { AccountSearchThrottlerGuard } from './admin-accounts-throttler.module.js';
import { AccountStatusService } from './account-status.service.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import {
  AccountRecordDto,
  AccountStatusChangedDto,
  AccountSummaryDto,
} from './dto/account-record.dto.js';
import { AccountSearchQueryDto } from './dto/account-search-query.dto.js';
import { DeactivateAccountDto, ReactivateAccountDto } from './dto/account-status-change.dto.js';

/**
 * SPEC-009 BR-009-13..BR-009-21: account administration. Every route is `@AdminOnly()` (`users.isAdmin`
 * and a confirmed email, BR-002-23, SC-09): a non-admin is 403, an anonymous request 401, on every
 * one of them. The admin sees the ACCOUNT record and nothing the account keeps in the product
 * (RF-ADM-06), every search and every record viewed is logged (BR-009-14), and the only writes are
 * the two status changes below: there is no route that edits a name, an email, personas, memberships
 * or a plan (BR-009-21), and a body naming any other field is refused by the whitelist (AR-34).
 */
@ApiTags('admin-accounts')
@ApiErrorResponses()
@ApiJwtAuth()
@Controller('admin/accounts')
export class AdminAccountsController {
  constructor(
    private readonly accounts: AdminAccountsService,
    private readonly status: AccountStatusService,
  ) {}

  @Get()
  @AdminOnly()
  @UseGuards(AccountSearchThrottlerGuard) // SC-04: 30 a minute per admin account
  @ApiOperation({
    summary: 'Search accounts by part of a name or an email (admin, paginated, logged)',
    description:
      'Case-insensitive CONTAINS over the name and the email, 3 to 100 characters after trimming ' +
      '(BR-009-13). Answers a row per account (id, name, email, status, creation date): the full ' +
      'record is `GET /admin/accounts/{id}`. Never a pending sign-up. The search is logged with its ' +
      'kind, length and a keyed hash of the terms, never the terms (BR-009-14); if the log cannot be ' +
      'written nothing is returned.',
  })
  @ApiPaginatedResponse(AccountSummaryDto)
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
  async search(
    @Access() admin: AccessContext,
    @Query() query: AccountSearchQueryDto,
  ): Promise<Paginated<AccountSummaryDto>> {
    const page = await this.accounts.search(admin, query);
    return mapPage(page, (account) => new AccountSummaryDto(account));
  }

  @Get(':id')
  @AdminOnly()
  @ApiOperation({
    summary: 'The record of one account (admin, logged)',
    description:
      'Name, email, phone, creation date, sign-in methods, whether the email is confirmed, status, ' +
      'personas, the names of the offices it belongs to, the plan and subscription status, and the ' +
      'history of its deactivations and reactivations (BR-009-13, BR-009-17). Nothing the account ' +
      'keeps in the product. The view is logged before it is returned (BR-009-14).',
  })
  @ApiOkResponse({ type: AccountRecordDto })
  @ApiNotFoundResponse({
    description: 'NOT_FOUND: unknown, malformed or pending',
    type: ErrorResponseDto,
  })
  async record(@Access() admin: AccessContext, @Param('id') id: string): Promise<AccountRecordDto> {
    return this.accounts.record(admin, id);
  }

  @Post(':id/deactivate')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate an account, with a required reason (admin)',
    description:
      'From the account’s next request it cannot sign in by any method, its sessions are refused for ' +
      'good, it receives no notifications and its reminders are not sent. Nothing is deleted or moved ' +
      'and no subscription is cancelled (BR-009-15, BR-009-16). An admin cannot deactivate their own ' +
      'account (CANNOT_DEACTIVATE_OWN_ACCOUNT, BR-009-19); an account that is not active is ' +
      'ACCOUNT_STATE_CONFLICT.',
  })
  @ApiOkResponse({ type: AccountStatusChangedDto })
  @ApiNotFoundResponse({ description: 'NOT_FOUND', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'ACCOUNT_STATE_CONFLICT', type: ErrorResponseDto })
  async deactivate(
    @Access() admin: AccessContext,
    @Param('id') id: string,
    @Body() dto: DeactivateAccountDto,
  ): Promise<AccountStatusChangedDto> {
    return new AccountStatusChangedDto(await this.status.deactivate(admin, id, dto.reason));
  }

  @Post(':id/reactivate')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivate a deactivated account, with an optional note (admin)',
    description:
      'Restores sign-in with memberships as they were; no earlier session comes back and reminders ' +
      'whose time passed while deactivated are not sent (BR-009-17). An account that is not ' +
      'deactivated is ACCOUNT_STATE_CONFLICT.',
  })
  @ApiOkResponse({ type: AccountStatusChangedDto })
  @ApiNotFoundResponse({ description: 'NOT_FOUND', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'ACCOUNT_STATE_CONFLICT', type: ErrorResponseDto })
  async reactivate(
    @Access() admin: AccessContext,
    @Param('id') id: string,
    @Body() dto: ReactivateAccountDto,
  ): Promise<AccountStatusChangedDto> {
    return new AccountStatusChangedDto(await this.status.reactivate(admin, id, dto.note ?? ''));
  }
}
