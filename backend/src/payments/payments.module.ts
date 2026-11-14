import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PaymentGatewayModule } from './payment-gateway.module.js';
import { UsersModule } from '../users/users.module.js';
import { CouponsModule } from '../coupons/coupons.module.js';

@Module({
  imports: [UsersModule, CouponsModule, ConfigModule, PaymentGatewayModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
