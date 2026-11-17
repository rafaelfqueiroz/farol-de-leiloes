import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { FEATURE_MODULES } from './feature-modules.js';
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
    ...FEATURE_MODULES,
  ],
})
export class AppModule {}
