import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../../common/common.module.js';
import businessConfig from '../../config/business.config.js';
import schedulerConfig from '../../config/scheduler.config.js';
import { LegalValidationsRepository } from '../legal-validation/legal-validations.repository.js';
import { JobLockRepository } from '../rights/job-lock.repository.js';
import { JobLockService } from '../rights/job-lock.service.js';
import { JobLockEntity, JobLockSchema } from '../schemas/job-lock.schema.js';
import {
  LegalValidationEntity,
  LegalValidationSchema,
} from '../schemas/legal-validation.schema.js';
import {
  RetentionDeletionEntity,
  RetentionDeletionSchema,
} from '../schemas/retention-deletion.schema.js';
import {
  CLOSED_JOURNEY_FILES_SOURCE,
  NoClosedJourneyFilesSource,
} from './closed-journey-files.source.js';
import { DocumentRetentionJob } from './document-retention.job.js';
import { RetentionDeletionsRepository } from './retention-deletions.repository.js';
import { RetentionService } from './retention.service.js';

/**
 * SPEC-010 part 3 (#10): the retention of the documents of closed journeys (BR-010-18..21, BR-010-24).
 * The clock is the pure `privacy/domain/retention.ts`; this module runs it every day over the files
 * SPEC-017 holds and logs each deletion in `retentionDeletions`.
 *
 * `CLOSED_JOURNEY_FILES_SOURCE` is bound here, to NONE, until SPEC-017 binds its own at this one place
 * (the way AccessModule binds the access sources and PrivacyRightsModule the closure hooks). SPEC-017
 * owns the storage and holds no retention setting: `DOCUMENT_RETENTION_YEARS` is SPEC-010's. The index
 * of `retentionDeletions` is built by migration 0010-retention-legal-indexes (AR-29). The run-level
 * lock reuses the privacy jobs' `JobLockService` (a stateless service over the `jobLocks` collection).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RetentionDeletionEntity.name, schema: RetentionDeletionSchema },
      { name: JobLockEntity.name, schema: JobLockSchema },
      // Read only, for the safety brake: the period the lawyer's newest validation reviewed.
      { name: LegalValidationEntity.name, schema: LegalValidationSchema },
    ]),
    ConfigModule.forFeature(businessConfig), // AR-43: DOCUMENT_RETENTION_YEARS
    ConfigModule.forFeature(schedulerConfig), // AR-04: DOCUMENT_RETENTION_ENABLED
    CommonModule, // AR-24: the Clock, and the job executions
  ],
  providers: [
    { provide: CLOSED_JOURNEY_FILES_SOURCE, useClass: NoClosedJourneyFilesSource },
    JobLockRepository,
    JobLockService,
    LegalValidationsRepository,
    RetentionDeletionsRepository,
    RetentionService,
    DocumentRetentionJob,
  ],
})
export class PrivacyRetentionModule {}
