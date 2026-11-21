import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../../common/common.module.js';
import businessConfig from '../../config/business.config.js';
import { type Env, legalGateEnforced } from '../../config/env.js';
import schedulerConfig from '../../config/scheduler.config.js';
import { PrivacyModule } from '../privacy.module.js';
import {
  LegalValidationEntity,
  LegalValidationSchema,
} from '../schemas/legal-validation.schema.js';
import { LaunchChecklistController } from './launch-checklist.controller.js';
import { LaunchChecklistService } from './launch-checklist.service.js';
import { LegalValidationGuard } from './legal-validation.guard.js';
import { LegalValidationService } from './legal-validation.service.js';
import { LegalValidationsRepository } from './legal-validations.repository.js';

/**
 * SPEC-010 part 3 (#10): the lawyer's validation as a gate (BR-010-25, BR-010-26, DL-010-07) and the
 * launch checklist (BR-010-24..26). `LegalValidationService.isValidated(scope)` reads the records; the
 * guard behind `@RequiresLegalValidation(scope)` refuses in production-like environments until the
 * scope is validated. A module with a gated route (SPEC-015, SPEC-024) imports this one.
 *
 * Nothing in the API writes a validation: `npm run legal:record-validation` does (legal-validation/
 * record/), and `test/structural/legal-validation-write-path.spec.ts` holds that. The index of
 * `legalValidations` is built by migration 0010-retention-legal-indexes (AR-29).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LegalValidationEntity.name, schema: LegalValidationSchema },
    ]),
    ConfigModule.forFeature(businessConfig), // AR-43: DOCUMENT_RETENTION_YEARS
    ConfigModule.forFeature(schedulerConfig), // AR-04: the job flags the checklist shows
    CommonModule, // AR-24
    PrivacyModule, // the documents in force (LegalDocumentsService)
  ],
  controllers: [LaunchChecklistController],
  providers: [
    LegalValidationsRepository,
    LegalValidationService,
    LegalValidationGuard,
    LaunchChecklistService,
  ],
  exports: [LegalValidationService, LegalValidationGuard],
})
export class LegalValidationModule implements OnModuleInit {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * BR-010-25: `LEGAL_GATE_ENFORCED=false` in production opens every legal-analysis route whatever
   * the validations say. Allowed (it is a switch), but never silent: a warning at every boot.
   */
  onModuleInit(): void {
    const env = {
      NODE_ENV: this.config.get('NODE_ENV', { infer: true }),
      LEGAL_GATE_ENFORCED: this.config.get('LEGAL_GATE_ENFORCED', { infer: true }),
    };
    if (env.NODE_ENV === 'production' && !legalGateEnforced(env)) {
      new Logger(LegalValidationModule.name).warn(
        'LEGAL_GATE_ENFORCED is false in production: the legal-analysis routes are NOT gated by the ' +
          "lawyer's validation (BR-010-25); the launch checklist is not ready while it stays so",
      );
    }
  }
}
