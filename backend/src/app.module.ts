import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AuctionsModule } from './auctions/auctions.module.js';
import { FavoritesModule } from './favorites/favorites.module.js';
import { SavedFiltersModule } from './saved-filters/saved-filters.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { CouponsModule } from './coupons/coupons.module.js';
import { RemindersModule } from './reminders/reminders.module.js';
import { AiModule } from './ai/ai.module.js';
import { SupportModule } from './support/support.module.js';
import { HealthModule } from './health/health.module.js';
import { ObservabilityModule } from './common/observability/observability.module.js';
import schedulerConfig from './config/scheduler.config.js';
import r2Config from './config/r2.config.js';
import businessConfig from './config/business.config.js';
import { validateEnv } from './config/env.js';
import { MONGOOSE_ROOT_OPTIONS } from './common/mongo/mongoose-root.js';

@Module({
  imports: [
    // AR-41: the environment is validated once, at boot; an invalid one stops the app.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      load: [schedulerConfig, r2Config, businessConfig],
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
