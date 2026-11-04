// The Nest context of `npm run migrate` (run.ts): the same validated environment and MongoDB
// connection as the API (AR-41), and the real Clock (AR-24) — no HTTP server, no schedulers.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../common/common.module';
import { MONGOOSE_ROOT_OPTIONS } from '../common/mongo/mongoose-root';
import { validateEnv } from '../config/env';

@Module({
  imports: [
    // AR-41: the environment is validated as at the API's boot; an invalid one stops the run.
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    MongooseModule.forRootAsync(MONGOOSE_ROOT_OPTIONS),
    CommonModule,
  ],
})
export class MigrationsModule {}
