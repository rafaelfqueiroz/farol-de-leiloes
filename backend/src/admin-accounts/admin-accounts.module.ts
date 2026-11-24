import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminAccessModule } from '../admin-access/admin-access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommonModule } from '../common/common.module.js';
import { RemindersModule } from '../reminders/reminders.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccountStatusEventsRepository } from './account-status-events.repository.js';
import { AccountStatusService } from './account-status.service.js';
import {
  AccountSearchThrottlerGuard,
  AdminAccountsThrottlerModule,
} from './admin-accounts-throttler.module.js';
import { AdminAccountsController } from './admin-accounts.controller.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import { ACCOUNT_OFFICES_SOURCE, NoAccountOfficesSource } from './ports/account-offices.source.js';
import {
  AccountStatusEventEntity,
  AccountStatusEventSchema,
} from './schemas/account-status-event.schema.js';

/**
 * SPEC-009 BR-009-13..BR-009-21 (#9): account administration. The admin searches accounts, opens an
 * account record and deactivates or reactivates an account; every search and view is logged
 * (AdminAccessModule's AccountLookupLogger) and every status change is recorded in the insert-only
 * `accountStatusEvents` (indexes built by migration 0013-account-status-events-indexes, AR-29).
 *
 * ACCOUNT_OFFICES_SOURCE is SPEC-011's seam (the names of the offices an account belongs to); until it
 * binds its own, the default knows no office. It is bound HERE and not in AccessModule: it names
 * offices and grants nothing.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AccountStatusEventEntity.name, schema: AccountStatusEventSchema },
    ]),
    UsersModule,
    AuthModule, // AuthService.endAllSessionsAndLinks: the sessions of a deactivated account
    AdminAccessModule, // AccountLookupLogger: BR-009-14
    RemindersModule, // RemindersService.cancelDueOfAccount: BR-009-17
    SubscriptionsModule, // SubscriptionsService.displayedPlanOfAccount: BR-009-13
    CommonModule, // AR-24: the Clock
    AdminAccountsThrottlerModule, // SC-04: a per-account limit on searching
  ],
  controllers: [AdminAccountsController],
  providers: [
    AccountSearchThrottlerGuard,
    AccountStatusEventsRepository,
    AccountStatusService,
    AdminAccountsService,
    { provide: ACCOUNT_OFFICES_SOURCE, useClass: NoAccountOfficesSource },
  ],
})
export class AdminAccountsModule {}
