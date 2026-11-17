import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../common/common.module.js';
import { UsersModule } from '../users/users.module.js';
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
 * could read in production; SPEC-009 (support requests and the open/end routes), SPEC-016 and
 * SPEC-021 (the read services) add routes under `/api/admin/support-grants/:grantId/...`, each
 * `@AdminOnly()`, built on `SupportGrantService.contextForRead` and `GrantReadLogger`. Until then the
 * service is exercised by the isolation suite's probe (test/isolation/support/probe.module.ts), and
 * the support request source (AccessModule's SUPPORT_REQUEST_SOURCE) knows no request, so no grant
 * can be opened (BR-002-24).
 *
 * In the API (FEATURE_MODULES) so the isolation gate classifies its two collections and Mongoose
 * builds the one-open-grant-per-request index the open race relies on before SPEC-009 calls it.
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
  ],
  exports: [SupportGrantService, GrantReadLogger],
})
export class AdminAccessModule {}
