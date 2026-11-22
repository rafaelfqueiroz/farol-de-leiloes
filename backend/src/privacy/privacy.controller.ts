import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/auth.interface.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ConsentsService } from './consents.service.js';
import { PrivacyAccountThrottlerGuard } from './privacy-throttler.module.js';
import { AllowWithoutTerms } from './decorators/allow-without-terms.decorator.js';
import { AcceptTermsDto } from './dto/accept-terms.dto.js';
import { AcceptancesResponseDto } from './dto/acceptances-response.dto.js';
import {
  RecordWhatsappConsentDto,
  WhatsappConsentResponseDto,
} from './dto/whatsapp-consent.dto.js';
import { WhatsappConsentService } from './whatsapp-consent.service.js';

/**
 * SPEC-010: what the signed-in account accepted and consented to. Every route acts on the
 * AUTHENTICATED account: its id comes from the session, never from the path, the query or the body
 * (BR-002-11; a body naming a `userId` is refused by the whitelist). `@AllowWithoutTerms()`: the
 * account must be able to accept a new version, and the rights of BR-010-08..13 never wait for it
 * (BR-010-05).
 */
@ApiTags('privacy')
@ApiErrorResponses()
@ApiJwtAuth()
@AllowWithoutTerms()
@Controller('privacy')
export class PrivacyController {
  constructor(
    private readonly consents: ConsentsService,
    private readonly whatsapp: WhatsappConsentService,
  ) {}

  @Post('accept')
  @UseGuards(PrivacyAccountThrottlerGuard) // SC-04: per account
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept the current terms of use and privacy policy again (re-acceptance)',
    description:
      'Both versions must be the current ones; otherwise TERMS_VERSION_OUTDATED (409) with the ' +
      'current ones in the context. Idempotent: accepting what the account already accepted ' +
      "changes nothing (BR-010-03, BR-010-05). Answers the account's acceptances.",
  })
  @ApiOkResponse({ type: AcceptancesResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptTermsDto,
  ): Promise<AcceptancesResponseDto> {
    return new AcceptancesResponseDto(
      await this.consents.accept(
        user.userId,
        { terms: dto.termsVersion, privacy: dto.privacyVersion },
        user.consentResetAt,
      ),
    );
  }

  @Get('acceptances')
  @ApiOperation({
    summary: 'The versions of the terms and the privacy policy the signed-in account accepted',
    description:
      'Newest first, each with its time and how it happened (BR-010-03, BR-010-04). AR-35 ' +
      'lookup exemption: an account has two acceptances per published version.',
  })
  @ApiOkResponse({ type: AcceptancesResponseDto })
  async acceptances(@CurrentUser() user: AuthenticatedUser): Promise<AcceptancesResponseDto> {
    return new AcceptancesResponseDto(
      await this.consents.listFor(user.userId, user.consentResetAt),
    );
  }

  @Get('whatsapp-consent')
  @ApiOperation({
    summary: 'The WhatsApp consent of the signed-in account',
    description: 'The latest answer and when it was given; `none` before any answer (BR-010-27).',
  })
  @ApiOkResponse({ type: WhatsappConsentResponseDto })
  async whatsappConsent(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WhatsappConsentResponseDto> {
    return new WhatsappConsentResponseDto(
      await this.whatsapp.current(user.userId, user.consentResetAt),
    );
  }

  @Post('whatsapp-consent')
  @UseGuards(PrivacyAccountThrottlerGuard) // SC-04: per account
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Grant, withdraw or decline the WhatsApp consent',
    description:
      'Records the answer with the text version and the time, and marks the one-time request as ' +
      'answered (`whatsappPromptPending` of GET /auth/me turns false), whichever the answer. ' +
      'Answering what the latest answer already says records nothing new and answers the state. ' +
      'Withdrawing works at any time and from then on no WhatsApp message is sent (BR-010-27).',
  })
  @ApiOkResponse({ type: WhatsappConsentResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
  async recordWhatsappConsent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordWhatsappConsentDto,
  ): Promise<WhatsappConsentResponseDto> {
    return new WhatsappConsentResponseDto(
      await this.whatsapp.record(user.userId, dto.action, dto.method, user.consentResetAt),
    );
  }
}
