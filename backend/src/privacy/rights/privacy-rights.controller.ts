import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { AccessContext } from '../../access/access-context.js';
import { Access } from '../../access/decorators/access.decorator.js';
import { ApiJwtAuth } from '../../auth/decorators/api-jwt-auth.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/interfaces/auth.interface.js';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../../common/pagination/api-paginated-response.decorator.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { mapPage, type Paginated } from '../../common/pagination/paginated.js';
import { AllowWithoutTerms } from '../decorators/allow-without-terms.decorator.js';
import { PrivacyAccountThrottlerGuard } from '../privacy-throttler.module.js';
import { AccountClosureService } from './account-closure.service.js';
import { DataExportService } from './data-export.service.js';
import { MyDataService } from './my-data.service.js';
import { AccountClosureResponseDto, DeleteAccountDto } from './dto/delete-account.dto.js';
import { MyDataResponseDto } from './dto/my-data-response.dto.js';
import {
  DataExportLinkResponseDto,
  DataExportResponseDto,
} from './dto/data-export-response.dto.js';

/**
 * SPEC-010 BR-010-08..14: the data-subject rights of the signed-in account. Every route acts on the
 * AUTHENTICATED account: its id comes from the session, never from the path, the query or the body
 * (BR-002-11; a body naming a `userId` is refused by the whitelist, an export id of another account is
 * the same 404 as a missing one, AR-14). `@AllowWithoutTerms()`: these rights never wait for the
 * newest terms to be accepted (BR-010-05, DL-010-03). The sensitive routes are throttled per account
 * (SC-04), on the counter the consent routes share.
 */
@ApiTags('privacy')
@ApiErrorResponses()
@ApiJwtAuth()
@AllowWithoutTerms()
@Controller('privacy')
export class PrivacyRightsController {
  constructor(
    private readonly closure: AccountClosureService,
    private readonly exports: DataExportService,
    private readonly myData: MyDataService,
  ) {}

  @Post('delete-account')
  @UseGuards(PrivacyAccountThrottlerGuard) // SC-04: per account
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Delete the signed-in account (closes it now, erases its personal data within 30 days)',
    description:
      'Needs the proof of identity again: exactly one of `password` (the current one, counted like a ' +
      'sign-in attempt: CURRENT_PASSWORD_INCORRECT, past 10 in 15 minutes TOO_MANY_ATTEMPTS) or ' +
      '`googleCode` (the one-time code of a fresh Google sign-in of this account: INVALID_GOOGLE_CODE ' +
      "when unknown, used, expired or another account's), and `confirm: true`. An account with neither " +
      'a password nor Google is REAUTHENTICATION_UNAVAILABLE. The account is closed at once and for good: ' +
      'every sign-in method is refused, every session ends, no notification is sent again (BR-010-14). ' +
      'Its personal data is deleted by a scheduled job within 30 days (BR-010-15), never inline. ' +
      'Closing an account that is already closed answers the same success (idempotent).',
  })
  @ApiOkResponse({ type: AccountClosureResponseDto })
  @ApiTooManyRequestsResponse({
    description: 'TOO_MANY_ATTEMPTS or TOO_MANY_REQUESTS',
    type: ErrorResponseDto,
  })
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
    @Ip() ip: string,
  ): Promise<AccountClosureResponseDto> {
    await this.closure.closeOwnAccount(user.userId, dto.proof(), ip ?? 'unknown');
    return new AccountClosureResponseDto();
  }

  @Get('my-data')
  @UseGuards(PrivacyAccountThrottlerGuard) // SC-04: per account (it reads every provider)
  @ApiOperation({
    summary: 'The personal data the platform holds for the signed-in account',
    description:
      'The same content as the export file, produced at once: `{ schemaVersion, generatedAt, <section>... }` ' +
      'with the account, favorites, saved filters, reminders, notification logs, sessions, acceptances, ' +
      'export requests and pseudonyms (BR-010-08). Never the password hash, never data an office owns ' +
      '(BR-010-10). AR-35 lookup exemption: the complete set, by nature. SC-15: never logged.',
  })
  @ApiExtraModels(MyDataResponseDto)
  @ApiOkResponse({
    description: "The account's own data, one section per provider",
    schema: {
      allOf: [
        { $ref: getSchemaPath(MyDataResponseDto) },
        { type: 'object', additionalProperties: true },
      ],
    },
  })
  async myDataView(@Access() access: AccessContext): Promise<Record<string, unknown>> {
    return { ...(await this.myData.view(access)) };
  }

  @Post('exports')
  @UseGuards(PrivacyAccountThrottlerGuard) // SC-04: per account
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Ask for a complete export of the account's data",
    description:
      'Queues one export, built without manual work (BR-010-11); one live export per account: when one ' +
      'is queued or ready, that one is answered. Poll `GET /privacy/exports`; when `ready`, ' +
      '`GET /privacy/exports/{id}/download` issues a 60-second link. It stays downloadable 7 days.',
  })
  @ApiAcceptedResponse({ type: DataExportResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
  async requestExport(@CurrentUser() user: AuthenticatedUser): Promise<DataExportResponseDto> {
    return new DataExportResponseDto(await this.exports.request(user.userId));
  }

  @Get('exports')
  @ApiOperation({ summary: "The account's own exports, newest first (paginated, AR-35)" })
  @ApiPaginatedResponse(DataExportResponseDto)
  async listExports(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<DataExportResponseDto>> {
    const page = await this.exports.list(user.userId, query);
    return mapPage(page, (view) => new DataExportResponseDto(view));
  }

  @Get('exports/:id/download')
  @UseGuards(PrivacyAccountThrottlerGuard) // SC-04: per account
  @ApiOperation({
    summary: 'A 60-second link to the export file, for its owner only',
    description:
      "Another account's export, a missing and a malformed id are the same 404 NOT_FOUND (AR-14, " +
      'BR-002-12). EXPORT_NOT_READY (409) while it is queued; EXPORT_EXPIRED (410) from 7 days after ' +
      'it was ready (a half-open window: 7 days and 1 minute is refused); a failed or cancelled export ' +
      'has no file (404). The link is never stored or logged (SC-18).',
  })
  @ApiOkResponse({ type: DataExportLinkResponseDto })
  @ApiNotFoundResponse({ description: 'NOT_FOUND', type: ErrorResponseDto })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DataExportLinkResponseDto> {
    return new DataExportLinkResponseDto(await this.exports.downloadLink(user.userId, id));
  }
}
