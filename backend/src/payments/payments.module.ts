import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { PaymentsController } from './payments.controller.js';

/**
 * The payment provider's HTTP edge: the webhook, delegating to SubscriptionsService. The port and
 * its Stripe adapter are PaymentGatewayModule's; subscriptions are SubscriptionsModule's.
 */
@Module({
  imports: [SubscriptionsModule],
  controllers: [PaymentsController],
})
export class PaymentsModule {}
