import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StripePaymentGateway } from './adapters/stripe-payment-gateway.js';
import { PaymentGateway } from './payment-gateway.js';

/**
 * AR-10: binds the PaymentGateway port to its Stripe adapter, once. Its own module so both
 * PaymentsModule and CouponsModule can import it without importing each other (PaymentsModule
 * already imports CouponsModule).
 */
@Module({
  imports: [ConfigModule],
  providers: [{ provide: PaymentGateway, useClass: StripePaymentGateway }],
  exports: [PaymentGateway],
})
export class PaymentGatewayModule {}
