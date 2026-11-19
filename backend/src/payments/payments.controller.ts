import { Public } from '../auth/decorators/public.decorator.js';
import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { DomainError } from '../common/errors/domain-error.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { WebhookAckResponseDto } from './dto/payments-response.dto.js';

/**
 * SPEC-012 BR-012-14, SC-11: the payment provider's webhook is the ONLY route that changes a
 * subscription. There is no user endpoint that sets a plan, a status or a limit; checkout and
 * plan management for offices arrive with the billing PR and are office-scoped.
 */
@ApiTags('payments')
@ApiErrorResponses()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

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
    await this.subscriptions.handleWebhook(req.rawBody, signature);
    return new WebhookAckResponseDto();
  }
}
