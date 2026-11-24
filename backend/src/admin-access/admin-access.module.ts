import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../common/common.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccountLookupLogger } from './account-lookup-logger.js';
import { AdminAccessLogRepository } from './admin-access-log.repository.js';
import { GrantReadLogger } from './grant-read-logger.js';
import { AdminAccessLogEntity, AdminAccessLogSchema } from './schemas/admin-access-log.schema.js';
import {
  SupportAccessGrantEntity,
  SupportAccessGrantSchema,
} from './schemas/support-access-grant.schema.js';
import { SupportAccessGrantRepository } from './support-access-grant.repository.js';
import { SupportGrantService } from './support-grant.service.js';

/**
 * SPEC-002 BR-002-23..BR-002-27 (ARCHITECTURE §4): support access grants and the admin access log.
 *
 * No controller on purpose. No client-data read service exists yet, so there is nothing a grant
 * could read in production; SPEC-016 and SPEC-021 (the read services) add routes under
 * `/api/admin/support-grants/:grantId/...`, each `@AdminOnly()`, built on
 * `SupportGrantService.contextForRead` and `GrantReadLogger`. Until then the service is exercised by
 * the isolation suite's probe (test/isolation/support/probe.module.ts). SPEC-009 opens a grant from
 * its support request routes (`support/support-admin.controller.ts`, through `SupportGrantService`)
 * and logs the admin's account searches and views (`AccountLookupLogger`, BR-009-14): both are
 * exported from here, so the log keeps ONE writer (AR-30).
 *
 * In the API (FEATURE_MODULES) so the isolation gate classifies its two collections. Their indexes,
 * the one-open-grant-per-request index the open race relies on included, are built by migration
 * 0005-admin-access-indexes in the deploy's migration step (AR-29, DV-34), not left to autoIndex.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupportAccessGrantEntity.name, schema: SupportAccessGrantSchema },
      { name: AdminAccessLogEntity.name, schema: AdminAccessLogSchema },
    ]),
    UsersModule,
    CommonModule,
  ],
  providers: [
    SupportAccessGrantRepository,
    AdminAccessLogRepository,
    SupportGrantService,
    GrantReadLogger,
    AccountLookupLogger,
  ],
  exports: [SupportGrantService, GrantReadLogger, AccountLookupLogger],
})
export class AdminAccessModule {}
