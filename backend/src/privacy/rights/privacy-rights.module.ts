import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../../auth/auth.module.js';
import { CommonModule } from '../../common/common.module.js';
import businessConfig from '../../config/business.config.js';
import schedulerConfig from '../../config/scheduler.config.js';
import { RemindersModule } from '../../reminders/reminders.module.js';
import { StorageModule } from '../../storage/storage.module.js';
import { UsersModule } from '../../users/users.module.js';
import {
  PrivacyThrottlerModule,
  PrivacyAccountThrottlerGuard,
} from '../privacy-throttler.module.js';
import { PersonalDataRegistryModule } from '../registry/personal-data-registry.module.js';
import { ActorPseudonymEntity, ActorPseudonymSchema } from '../schemas/actor-pseudonym.schema.js';
import { DataExportEntity, DataExportSchema } from '../schemas/data-export.schema.js';
import { JobLockEntity, JobLockSchema } from '../schemas/job-lock.schema.js';
import { AccountClosureService, ACCOUNT_CLOSURE_HOOKS } from './account-closure.service.js';
import { AccountPurgeJob } from './account-purge.job.js';
import { ActorPseudonymsPersonalData } from './actor-pseudonym.personal-data.js';
import { ActorPseudonymRepository } from './actor-pseudonym.repository.js';
import { ActorPseudonymService } from './actor-pseudonym.service.js';
import { DataExportJob } from './data-export.job.js';
import { DataExportService } from './data-export.service.js';
import { DataExportWorker } from './data-export.worker.js';
import { DataExportsPersonalData } from './data-exports.personal-data.js';
import { DataExportsRepository } from './data-exports.repository.js';
import { JobLockRepository } from './job-lock.repository.js';
import { JobLockService } from './job-lock.service.js';
import { MyDataService } from './my-data.service.js';
import { PrivacyRightsController } from './privacy-rights.controller.js';

/**
 * SPEC-010 part 2 (#10): the data-subject rights: the personal-data view and the export (BR-010-08..
 * 11), the closure of the account (BR-010-13, BR-010-14), the purge of closed accounts (BR-010-15),
 * and the stable pseudonyms of people who left (BR-010-28). It sits ABOVE `AuthModule` (closure needs
 * re-authentication, sessions and links, which AuthModule owns) and `PrivacyModule` stays below it
 * (AuthModule imports that one; this one must not be imported by AuthModule: no cycle, AR-09).
 *
 * Exported for the other specs: `ActorPseudonymService.forPerson` / `detachUser` (SPEC-011, SPEC-016).
 * `ACCOUNT_CLOSURE_HOOKS` is bound here, to NONE, until a spec binds its own at this one place
 * (SPEC-011 ends client links and memberships, SPEC-012 its billing steps), the way AccessModule binds
 * the access sources. The indexes of `dataExports` and `actorPseudonyms` are built by migration
 * 0009-privacy-rights-indexes (AR-29).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DataExportEntity.name, schema: DataExportSchema },
      { name: ActorPseudonymEntity.name, schema: ActorPseudonymSchema },
      { name: JobLockEntity.name, schema: JobLockSchema },
    ]),
    ConfigModule.forFeature(businessConfig), // AR-43: EXPORT_TTL_DAYS, the purge alert settings
    ConfigModule.forFeature(schedulerConfig), // AR-04: ACCOUNT_PURGE_ENABLED, DATA_EXPORT_ENABLED
    CommonModule, // AR-24: the Clock, and the job executions
    UsersModule,
    AuthModule, // re-authentication, sessions and links
    StorageModule, // the private bucket (SC-18)
    RemindersModule, // closure cancels the account's pending reminders
    PersonalDataRegistryModule,
    PrivacyThrottlerModule, // SC-04: a per-account limit on the sensitive routes
  ],
  controllers: [PrivacyRightsController],
  providers: [
    { provide: ACCOUNT_CLOSURE_HOOKS, useValue: [] },
    PrivacyAccountThrottlerGuard,
    JobLockRepository,
    JobLockService,
    DataExportsRepository,
    DataExportService,
    DataExportWorker,
    DataExportJob,
    DataExportsPersonalData,
    ActorPseudonymRepository,
    ActorPseudonymService,
    ActorPseudonymsPersonalData,
    MyDataService,
    AccountClosureService,
    AccountPurgeJob,
  ],
  exports: [ActorPseudonymService],
})
export class PrivacyRightsModule {}
