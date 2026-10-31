import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AuctionsModule } from './auctions/auctions.module';
import { FavoritesModule } from './favorites/favorites.module';
import { SavedFiltersModule } from './saved-filters/saved-filters.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PaymentsModule } from './payments/payments.module';
import { CouponsModule } from './coupons/coupons.module';
import { RemindersModule } from './reminders/reminders.module';
import { AiModule } from './ai/ai.module';
import { SupportModule } from './support/support.module';
import schedulerConfig from './config/scheduler.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [schedulerConfig],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        return {
          uri: configService.get("MONGODB_URI"),
          retryAttempts: 3,
        }
      },
    }),
    ScheduleModule.forRoot(),
    UsersModule,
    AuthModule,
    AuctionsModule,
    FavoritesModule,
    SavedFiltersModule,
    PaymentsModule,
    CouponsModule,
    RemindersModule,
    AiModule,
    SupportModule,
  ],
})
export class AppModule {}

