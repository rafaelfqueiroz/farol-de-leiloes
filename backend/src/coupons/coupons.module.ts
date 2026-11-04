import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';
import { CouponEntity, CouponSchema } from './schemas/coupon.schema';
import { CommonModule } from '../common/common.module';
import { PaymentGatewayModule } from '../payments/payment-gateway.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: CouponEntity.name, schema: CouponSchema }]),
    // AR-24: the Clock; AR-10: the payment provider's port.
    CommonModule,
    PaymentGatewayModule,
  ],
  controllers: [CouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
