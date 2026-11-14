import { Public } from '../auth/decorators/public.decorator.js';
import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service.js';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface.js';
import { DomainError } from '../common/errors/domain-error.js';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { MessageResponseDto } from '../common/dto/message-response.dto.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import {
  CheckoutSessionResponseDto,
  SubscriptionStatusResponseDto,
  WebhookAckResponseDto,
} from './dto/payments-response.dto.js';

@ApiTags('payments')
@ApiErrorResponses()
@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('create-checkout-session')
  @ApiJwtAuth()
  @ApiOperation({ summary: 'Open a Stripe Checkout session for a plan' })
  @ApiCreatedResponse({ type: CheckoutSessionResponseDto })
  async createCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCheckoutSessionDto,
  ): Promise<CheckoutSessionResponseDto> {
    const session = await this.paymentsService.createCheckoutSession(
      user.userId,
      user.email,
      dto.planId,
      dto.couponCode,
    );
    return new CheckoutSessionResponseDto(session);
  }

  // AR-34 exemption: Stripe's signature covers the exact bytes it sent, so this route reads the
  // raw body (rawBody, main.ts) instead of a parsed, validated DTO; the signature check is the
  // validation. Documented here, and exempted by name in openapi.spec.ts.
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook: verifies the signature over the raw body' })
  @ApiHeader({
    name: 'stripe-signature',
    required: true,
    description: 'Stripe signature of the raw body',
  })
  @ApiBody({
    description: 'A Stripe event, verified over its exact bytes; never re-serialised',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiOkResponse({ type: WebhookAckResponseDto })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<WebhookAckResponseDto> {
    // rawBody is enabled in main.ts; without it the signature cannot be checked (DV-03).
    if (!req.rawBody) {
      throw new DomainError('INVALID_WEBHOOK_SIGNATURE');
    }
    await this.paymentsService.handleWebhook(req.rawBody, signature);
    return new WebhookAckResponseDto();
  }

  @Get('subscription-status')
  @ApiJwtAuth()
  @ApiOperation({ summary: 'The signed-in user plan and subscription state' })
  @ApiOkResponse({ type: SubscriptionStatusResponseDto })
  async getSubscriptionStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubscriptionStatusResponseDto> {
    const status = await this.paymentsService.getSubscriptionStatus(user.userId);
    return new SubscriptionStatusResponseDto(status);
  }

  @Post('cancel-subscription')
  @HttpCode(HttpStatus.OK)
  @ApiJwtAuth()
  @ApiOperation({ summary: 'Cancel the signed-in user subscription' })
  @ApiOkResponse({ type: MessageResponseDto })
  async cancelSubscription(@CurrentUser() user: AuthenticatedUser): Promise<MessageResponseDto> {
    await this.paymentsService.cancelSubscription(user.userId);
    return new MessageResponseDto('Assinatura cancelada com sucesso');
  }
}
