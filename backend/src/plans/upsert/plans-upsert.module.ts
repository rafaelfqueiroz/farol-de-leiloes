// The Nest context of `npm run plans:upsert` (run.ts): the same validated environment and MongoDB
// connection as the API (AR-41), the plan catalog only. No HTTP server, no schedulers.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MONGOOSE_ROOT_OPTIONS } from '../../common/mongo/mongoose-root.js';
import { validateEnv } from '../../config/env.js';
import { PlansModule } from '../plans.module.js';
import { PlansUpsertCommand } from './plans-upsert.command.js';

@Module({
  imports: [
    // AR-41: the environment is validated as at the API's boot; an invalid one stops the run.
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    MongooseModule.forRootAsync(MONGOOSE_ROOT_OPTIONS),
    PlansModule,
  ],
  providers: [PlansUpsertCommand],
})
export class PlansUpsertModule {}
