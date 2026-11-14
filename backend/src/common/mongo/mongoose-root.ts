// The one MongoDB connection setup, shared by the API (AppModule) and the migrations entry point
// (MigrationsModule), so both reach the database the validated environment names (AR-41).
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { MongooseModuleAsyncOptions } from '@nestjs/mongoose';
import type { AppConfigService } from '../../config/env.js';
import { applyMongooseDefaults } from './query-safety.js';

export const MONGOOSE_ROOT_OPTIONS: MongooseModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: AppConfigService) => {
    // SC-10: before the first query, so no filter is ever read with operators from a request.
    applyMongooseDefaults();
    return {
      uri: config.get('MONGODB_URI', { infer: true }),
      retryAttempts: 3,
    };
  },
};
