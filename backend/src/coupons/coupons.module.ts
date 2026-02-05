import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';
import { CouponEntity, CouponSchema } from './schemas/coupon.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: CouponEntity.name, schema: CouponSchema }]),
    ConfigModule,
  ],
  controllers: [CouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
