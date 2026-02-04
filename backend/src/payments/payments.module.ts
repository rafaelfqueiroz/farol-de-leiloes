import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { UsersModule } from '../users/users.module';
import { CouponsModule } from '../coupons/coupons.module';

@Module({
  imports: [UsersModule, CouponsModule, ConfigModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
