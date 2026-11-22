// The Nest context of `npm run legal:record-validation` (run.ts): the same validated environment and
// MongoDB connection as the API (AR-41), the insert-only validations repository and the legal registry.
// No HTTP server, no schedulers, no other module.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../../../common/common.module.js';
import { MONGOOSE_ROOT_OPTIONS } from '../../../common/mongo/mongoose-root.js';
import { validateEnv } from '../../../config/env.js';
import { LEGAL_DOCUMENTS, LEGAL_REGISTRY } from '../../legal/registry.js';
import {
  LegalValidationEntity,
  LegalValidationSchema,
} from '../../schemas/legal-validation.schema.js';
import { LegalValidationsRepository } from '../legal-validations.repository.js';
import { RecordValidationCommand } from './record-validation.command.js';

@Module({
  imports: [
    // AR-41: the environment is validated as at the API's boot; an invalid one stops the run.
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    MongooseModule.forRootAsync(MONGOOSE_ROOT_OPTIONS),
    MongooseModule.forFeature([
      { name: LegalValidationEntity.name, schema: LegalValidationSchema },
    ]),
    CommonModule,
  ],
  providers: [
    { provide: LEGAL_DOCUMENTS, useValue: LEGAL_REGISTRY },
    LegalValidationsRepository,
    RecordValidationCommand,
  ],
})
export class RecordValidationModule {}
