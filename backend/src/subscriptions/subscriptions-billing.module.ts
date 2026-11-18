import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../common/common.module.js';
import businessConfig from '../config/business.config.js';
import schedulerConfig from '../config/scheduler.config.js';
import { CouponsModule } from '../coupons/coupons.module.js';
import { PaymentGatewayModule } from '../payments/payment-gateway.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { AccountThrottlerGuard, BillingThrottlerModule } from './billing-throttler.module.js';
import { CheckoutStatusController } from './checkout-status.controller.js';
import { OfficeSubscriptionController } from './office-subscription.controller.js';
import { SubscriptionsBillingService } from './subscriptions-billing.service.js';
import { SubscriptionsReconcileJob } from './subscriptions-reconcile.job.js';
import { SubscriptionsModule } from './subscriptions.module.js';

/**
 * SPEC-012 BR-012-11 and the billing rules: what an office does with its plan (ARCHITECTURE §13): checkout, change,
 * cancel with the 7-day refund, undo, the billing portal, the success page's status, and the
 * daily reconcile job.
 *
 * Kept apart from `SubscriptionsModule`, which `AccessModule` imports for the office plan source and
 * which `npm run grant-admin` therefore loads without an HTTP server, a scheduler or the coupon
 * catalog. The journey slots SPEC-016 calls (`JourneySlotsService`) are exported by
 * `SubscriptionsModule`, not from here.
 */
@Module({
  imports: [
    ConfigModule.forFeature(businessConfig),
    ConfigModule.forFeature(schedulerConfig),
    CommonModule, // AR-24: the Clock; job executions
    PaymentGatewayModule, // AR-10
    PlansModule,
    CouponsModule,
    SubscriptionsModule,
    BillingThrottlerModule, // SC-04: a per-account limit, every route can reach the provider
  ],
  controllers: [OfficeSubscriptionController, CheckoutStatusController],
  providers: [SubscriptionsBillingService, SubscriptionsReconcileJob, AccountThrottlerGuard],
})
export class SubscriptionsBillingModule {}
