import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';
import { RemindersRepository } from './reminders.repository.js';
import { NotificationLogsRepository } from './notification-logs.repository.js';
import { RemindersScheduler } from './reminders.scheduler.js';
import { ReminderEntity, ReminderSchema } from './schemas/reminder.schema.js';
import { NotificationLog, NotificationLogSchema } from './schemas/notification-log.schema.js';
import { AuctionsModule } from '../auctions/auctions.module.js';
import { UsersModule } from '../users/users.module.js';
import { EmailModule } from '../email/email.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CommonModule } from '../common/common.module.js';
import schedulerConfig from '../config/scheduler.config.js';
import { NotificationLogsPersonalData, RemindersPersonalData } from './reminders.personal-data.js';
import { PersonalDataRegistryModule } from '../privacy/registry/personal-data-registry.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReminderEntity.name, schema: ReminderSchema },
      { name: NotificationLog.name, schema: NotificationLogSchema },
    ]),
    ConfigModule.forFeature(schedulerConfig),
    AuctionsModule,
    UsersModule,
    EmailModule,
    NotificationsModule,
    CommonModule,
    PersonalDataRegistryModule, // SPEC-010: registered for export and purge
  ],
  controllers: [RemindersController],
  providers: [
    RemindersService,
    RemindersScheduler,
    RemindersRepository,
    NotificationLogsRepository,
    RemindersPersonalData,
    NotificationLogsPersonalData,
  ],
  exports: [RemindersService],
})
export class RemindersModule {}
