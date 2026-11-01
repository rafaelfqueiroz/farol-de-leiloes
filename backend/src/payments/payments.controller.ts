import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('create-checkout-session')
  @UseGuards(JwtAuthGuard)
  async createCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    return this.paymentsService.createCheckoutSession(
      user.userId,
      user.email,
      dto.planId,
      dto.couponCode,
    );
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    // rawBody is enabled in main.ts; without it the signature cannot be checked (DV-03).
    if (!req.rawBody) {
      throw new BadRequestException('Assinatura do webhook inválida');
    }
    await this.paymentsService.handleWebhook(req.rawBody, signature);
    return { received: true };
  }

  @Get('subscription-status')
  @UseGuards(JwtAuthGuard)
  async getSubscriptionStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.getSubscriptionStatus(user.userId);
  }

  @Post('cancel-subscription')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async cancelSubscription(@CurrentUser() user: AuthenticatedUser) {
    await this.paymentsService.cancelSubscription(user.userId);
    return { message: 'Assinatura cancelada com sucesso' };
  }
}
