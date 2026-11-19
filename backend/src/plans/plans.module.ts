import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import businessConfig from '../config/business.config.js';
import { PaymentGatewayModule } from '../payments/payment-gateway.module.js';
import { PlansController } from './plans.controller.js';
import { PlansThrottlerModule } from './plans-throttler.module.js';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';
import { PlanEntity, PlanSchema } from './schemas/plan.schema.js';

/** SPEC-012 BR-012-01..BR-012-05: the plan catalog and its public listing. */
@Module({
  imports: [
    ConfigModule.forFeature(businessConfig), // AR-43: the refund window the plans page states
    MongooseModule.forFeature([{ name: PlanEntity.name, schema: PlanSchema }]),
    PaymentGatewayModule, // AR-10: the catalog script checks each price at the provider
    PlansThrottlerModule, // SC-04: a coarse per-origin limit on the public listing
  ],
  controllers: [PlansController],
  providers: [PlansRepository, PlansService],
  exports: [PlansService],
})
export class PlansModule {}
