import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { RemindersScheduler } from './reminders.scheduler';
import { ReminderEntity, ReminderSchema } from './schemas/reminder.schema';
import {
  NotificationLog,
  NotificationLogSchema,
} from './schemas/notification-log.schema';
import { AuctionsModule } from '../auctions/auctions.module';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommonModule } from '../common/common.module';
import schedulerConfig from '../config/scheduler.config';

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
  ],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersScheduler],
  exports: [RemindersService],
})
export class RemindersModule {}
