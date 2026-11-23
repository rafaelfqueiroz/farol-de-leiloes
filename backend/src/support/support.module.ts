import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminAccessModule } from '../admin-access/admin-access.module.js';
import { CommonModule } from '../common/common.module.js';
import schedulerConfig from '../config/scheduler.config.js';
import { EmailModule } from '../email/email.module.js';
import { PersonalDataRegistryModule } from '../privacy/registry/personal-data-registry.module.js';
import { UsersModule } from '../users/users.module.js';
import { SupportCounterEntity, SupportCounterSchema } from './schemas/support-counter.schema.js';
import { SupportContactController } from './support-contact.controller.js';
import { SupportCountersRepository } from './support-counters.repository.js';
import { SupportMailJob } from './support-mail.job.js';
import { SupportMailService } from './support-mail.service.js';
import { SupportRequestsPersonalData } from './support-requests.personal-data.js';
import { SupportRequestsStoreModule } from './support-requests-store.module.js';
import {
  SupportAccountThrottlerGuard,
  SupportThrottlerModule,
} from './support-throttler.module.js';
import { SupportController } from './support.controller.js';
import { SupportService } from './support.service.js';

/**
 * SPEC-009 part 1 (#9): support requests. A request is a stored record (BR-009-06) with its outbox of
 * two emails (BR-009-07, BR-009-10), the requester's permission for the support team to view their
 * data (BR-009-08) and, through `SupportRequestsStoreModule`, the SUPPORT_REQUEST_SOURCE the access
 * module binds (SPEC-002 BR-002-24). The admin's routes (close a request, open a grant, the account
 * administration) are the next part.
 *
 * The indexes of `supportRequests` are built by migration 0012-support-requests-indexes (AR-29), and
 * the SUPPORT_MAIL_JOB_ENABLED flag switches the outbox worker off (AR-04).
 */
@Module({
  imports: [
    SupportRequestsStoreModule,
    MongooseModule.forFeature([{ name: SupportCounterEntity.name, schema: SupportCounterSchema }]),
    ConfigModule.forFeature(schedulerConfig), // AR-04: SUPPORT_MAIL_JOB_ENABLED
    CommonModule, // AR-24: the Clock, and the job executions
    EmailModule,
    UsersModule, // the requester's current name and address, at delivery time (BR-009-07)
    AdminAccessModule, // BR-009-08: withdrawing the permission ends the open grant
    PersonalDataRegistryModule, // SPEC-010: the requests are exported and purged with the account
    SupportThrottlerModule, // SC-04: a per-account limit on opening requests
  ],
  controllers: [SupportController, SupportContactController],
  providers: [
    SupportAccountThrottlerGuard,
    SupportCountersRepository,
    SupportService,
    SupportMailService,
    SupportMailJob,
    SupportRequestsPersonalData,
  ],
})
export class SupportModule {}
