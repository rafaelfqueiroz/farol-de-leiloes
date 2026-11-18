import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AccessContext } from '../access/access-context.js';
import { Access } from '../access/decorators/access.decorator.js';
import { ApiConfirmedEmail } from '../auth/decorators/api-confirmed-email.decorator.js';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ConfirmedEmailGuard } from '../auth/guards/confirmed-email.guard.js';
import type { AuthenticatedUser } from '../auth/interfaces/auth.interface.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import {
  ChangePlanRequestDto,
  CheckoutRequestDto,
  OfficeSelectorDto,
} from './dto/office-subscription-request.dto.js';
import {
  OfficeSubscriptionResponseDto,
  RedirectUrlResponseDto,
} from './dto/office-subscription-response.dto.js';
import { SubscriptionsBillingService } from './subscriptions-billing.service.js';

/**
 * SPEC-012 BR-012-11: the office's plan, for any current member. The office is the one
 * AccessContext chooses among the caller's own memberships, never a path id (AR-13, BR-002-11);
 * a non-member gets the same 404 as a missing office (AR-14). No route asks for a writable office:
 * a read-only or lapsed office manages its plan (BR-012-28).
 *
 * BR-012-14 still holds: nothing here sets a status, a plan or a limit. Each action asks the
 * payment provider, and the stored state follows what the provider reports (BR-012-13).
 */
@ApiTags('office-subscription')
@ApiErrorResponses()
@ApiJwtAuth()
@ApiConfirmedEmail()
@UseGuards(ConfirmedEmailGuard) // BR-001-04
@Controller('office/subscription')
export class OfficeSubscriptionController {
  constructor(private readonly billing: SubscriptionsBillingService) {}

  @Get()
  @ApiOperation({
    summary: 'The office plan: status, limit, journeys in progress, dates and billing history',
    description: 'SUBSCRIPTION_NOT_FOUND (404) when the office has never had a paid plan.',
  })
  @ApiOkResponse({ type: OfficeSubscriptionResponseDto })
  async get(
    @Access() access: AccessContext,
    @Query() query: OfficeSelectorDto,
  ): Promise<OfficeSubscriptionResponseDto> {
    return new OfficeSubscriptionResponseDto(await this.billing.view(access, query.officeId));
  }

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start the hosted checkout of a plan',
    description:
      'Grants nothing: the plan takes effect when the payment provider confirms payment ' +
      '(BR-012-09). INVALID_PLAN, COUPON_INVALID, SUBSCRIPTION_ALREADY_ACTIVE, CHECKOUT_IN_PROGRESS, ' +
      'OFFICE_CREATION_UNAVAILABLE (503) and CHECKOUT_SESSION_FAILED (502) are the refusals.',
  })
  @ApiOkResponse({ type: RedirectUrlResponseDto })
  async checkout(
    @Access() access: AccessContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CheckoutRequestDto,
  ): Promise<RedirectUrlResponseDto> {
    const { url } = await this.billing.checkout(
      access,
      { email: user.email, name: user.name },
      body,
    );
    return new RedirectUrlResponseDto(url);
  }

  @Post('change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change the plan: an upgrade applies once paid, a downgrade at the next period',
    description:
      'A higher limit is an upgrade (BR-012-16); an equal or lower one is scheduled for the next ' +
      'billing period (BR-012-17). SUBSCRIPTION_NOT_CHANGEABLE (409) when nothing is in effect.',
  })
  @ApiOkResponse({ type: OfficeSubscriptionResponseDto })
  async change(
    @Access() access: AccessContext,
    @Body() body: ChangePlanRequestDto,
  ): Promise<OfficeSubscriptionResponseDto> {
    return new OfficeSubscriptionResponseDto(await this.billing.changePlan(access, body));
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel: at the end of the paid period, or with a full refund inside the first 7 days',
    description:
      'BR-012-19, BR-012-29. SUBSCRIPTION_NOT_CANCELABLE (409) when nothing is in effect; ' +
      'cancelling what is already cancelling succeeds.',
  })
  @ApiOkResponse({ type: OfficeSubscriptionResponseDto })
  async cancel(
    @Access() access: AccessContext,
    @Body() body: OfficeSelectorDto,
  ): Promise<OfficeSubscriptionResponseDto> {
    return new OfficeSubscriptionResponseDto(await this.billing.cancel(access, body.officeId));
  }

  @Post('undo-cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Undo a cancellation before the paid period ends',
    description: 'BR-012-19. SUBSCRIPTION_NOT_CHANGEABLE (409) once the period has ended.',
  })
  @ApiOkResponse({ type: OfficeSubscriptionResponseDto })
  async undoCancel(
    @Access() access: AccessContext,
    @Body() body: OfficeSelectorDto,
  ): Promise<OfficeSubscriptionResponseDto> {
    return new OfficeSubscriptionResponseDto(await this.billing.undoCancel(access, body.officeId));
  }

  @Post('billing-portal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The payment provider page to update the payment method and see invoices',
    description: 'BILLING_PORTAL_FAILED (502) when the provider cannot open it.',
  })
  @ApiOkResponse({ type: RedirectUrlResponseDto })
  async billingPortal(
    @Access() access: AccessContext,
    @Body() body: OfficeSelectorDto,
  ): Promise<RedirectUrlResponseDto> {
    return new RedirectUrlResponseDto(
      (await this.billing.billingPortal(access, body.officeId)).url,
    );
  }
}
