import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AccessContext } from '../access/access-context.js';
import { Access } from '../access/decorators/access.decorator.js';
import { ApiConfirmedEmail } from '../auth/decorators/api-confirmed-email.decorator.js';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { ConfirmedEmailGuard } from '../auth/guards/confirmed-email.guard.js';
import { AccountThrottlerGuard } from './billing-throttler.module.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { CheckoutStatusResponseDto } from './dto/office-subscription-response.dto.js';
import { SubscriptionsBillingService } from './subscriptions-billing.service.js';

/**
 * SPEC-012 BR-012-09: the checkout success page asks whether the payment was confirmed. It is
 * authorised by the BUYER (the checkout's `buyerUserId` is the caller), never by an owner id, so the
 * ref in the path is safe to take: another account's ref is the same 404 as one that does not exist
 * (AR-14). The answer grants nothing; only the provider's confirmation does.
 */
@ApiTags('office-subscription')
@ApiErrorResponses()
@ApiJwtAuth()
@ApiConfirmedEmail()
@UseGuards(ConfirmedEmailGuard, AccountThrottlerGuard) // BR-001-04, SC-04: per account
@Controller('subscriptions/checkout')
export class CheckoutStatusController {
  constructor(private readonly billing: SubscriptionsBillingService) {}

  @Get(':ref/status')
  @ApiOperation({ summary: 'Whether the provider confirmed the payment of this checkout' })
  @ApiOkResponse({ type: CheckoutStatusResponseDto })
  @ApiNotFoundResponse({ description: 'NOT_FOUND', type: ErrorResponseDto })
  async status(
    @Access() access: AccessContext,
    @Param('ref') ref: string,
  ): Promise<CheckoutStatusResponseDto> {
    return new CheckoutStatusResponseDto(await this.billing.checkoutState(access, ref));
  }
}
