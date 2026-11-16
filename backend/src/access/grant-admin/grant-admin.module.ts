// The Nest context of `npm run grant-admin` (run.ts): the same validated environment and MongoDB
// connection as the API (AR-41), the users service and the SPEC-002 access sources. No HTTP
// server, no schedulers.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MONGOOSE_ROOT_OPTIONS } from '../../common/mongo/mongoose-root.js';
import { validateEnv } from '../../config/env.js';
import { UsersModule } from '../../users/users.module.js';
import { AccessModule } from '../access.module.js';
import { GrantAdminCommand } from './grant-admin.command.js';

@Module({
  imports: [
    // AR-41: the environment is validated as at the API's boot; an invalid one stops the run.
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    MongooseModule.forRootAsync(MONGOOSE_ROOT_OPTIONS),
    UsersModule,
    AccessModule,
  ],
  providers: [GrantAdminCommand],
})
export class GrantAdminModule {}
