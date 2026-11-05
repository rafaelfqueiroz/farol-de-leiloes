import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { HealthModule } from './health/health.module';
import { ObservabilityModule } from './common/observability/observability.module';
import schedulerConfig from './config/scheduler.config';
import r2Config from './config/r2.config';
import { validateEnv } from './config/env';
import { MONGOOSE_ROOT_OPTIONS } from './common/mongo/mongoose-root';

@Module({
  imports: [
    // AR-41: the environment is validated once, at boot; an invalid one stops the app.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      load: [schedulerConfig, r2Config],
    }),
    ObservabilityModule, // AR-45: nestjs-pino, before the modules that log
    MongooseModule.forRootAsync(MONGOOSE_ROOT_OPTIONS),
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
    HealthModule,
  ],
})
export class AppModule {}
