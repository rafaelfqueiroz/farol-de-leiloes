import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RemindersService } from './reminders.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../notifications/sms.service';
import { WhatsAppService } from '../notifications/whatsapp.service';
import { JobExecutionService } from '../common/services/job-execution.service';
import { RunMode } from '../common/schemas/job-execution.schema';
import { ReminderChannel, ReminderDocument } from './schemas/reminder.schema';
import { ReminderEmailPayload } from './templates/reminder.template';
import schedulerConfig, { SchedulerConfig } from '../config/scheduler.config';

@Injectable()
export class RemindersScheduler implements OnModuleInit {
  private readonly logger = new Logger(RemindersScheduler.name);
  private readonly jobName = 'reminders-processor';

  constructor(
    private readonly remindersService: RemindersService,
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly whatsAppService: WhatsAppService,
    private readonly jobExecutionService: JobExecutionService,
    @Inject(schedulerConfig.KEY) private readonly config: SchedulerConfig,
  ) {}

  async onModuleInit() {
    const { enabled } = this.config.reminders;

    if (!enabled) {
      this.logger.log('Reminders scheduler is disabled (REMINDERS_ENABLED=false)');
      return;
    }

    this.logger.log('Reminders scheduler initialized. Running every 15 minutes.');
  }

  @Cron('*/15 * * * *')
  async processReminders() {
    const { enabled } = this.config.reminders;

    if (!enabled) {
      return;
    }

    try {
      const dueReminders = await this.remindersService.getDueReminders(50);

      if (dueReminders.length === 0) {
        return;
      }

      this.logger.log(`Processing ${dueReminders.length} due reminders`);

      for (const reminder of dueReminders) {
        await this.processReminder(reminder);
      }

      await this.jobExecutionService.recordExecution(this.jobName, RunMode.AUTO);
    } catch (error: any) {
      this.logger.error(`Failed to process reminders: ${error.message}`);
    }
  }

  private async processReminder(reminder: ReminderDocument): Promise<void> {
    try {
      const user = await this.usersService.findByIdFull(reminder.userId.toString());
      if (!user) {
        this.logger.warn(`User not found for reminder ${reminder._id}`);
        return;
      }

      const auction = reminder.auction as any;

      let result: { success: boolean; errorMessage?: string };
      let recipient: string;

      switch (reminder.channel) {
        case ReminderChannel.EMAIL:
          recipient = user.email;
          result = await this.sendEmailReminder(user, auction, reminder);
          break;

        case ReminderChannel.SMS:
          recipient = user.phone!;
          result = await this.smsService.sendReminderSms(user.phone!, {
            auctionTitle: auction?.title || auction?.code || '',
            auctionCode: auction?.code || '',
            auctionCity: auction?.address?.city ?? null,
            auctionState: auction?.address?.state ?? null,
            description: reminder.description ?? null,
          });
          break;

        case ReminderChannel.WHATSAPP:
          recipient = user.phone!;
          result = await this.whatsAppService.sendReminderWhatsApp(user.phone!, {
            userName: user.name,
            auctionTitle: auction?.title || auction?.code || '',
            auctionCode: auction?.code || '',
            auctionCity: auction?.address?.city ?? null,
            auctionState: auction?.address?.state ?? null,
            auctionDetailsUrl: auction?.detailsUrl ?? null,
            description: reminder.description ?? null,
          });
          break;

        default:
          this.logger.error(`Unknown channel: ${reminder.channel}`);
          return;
      }

      await this.remindersService.logNotification(
        reminder._id.toString(),
        user._id.toString(),
        reminder.channel,
        recipient,
        result.success,
        result.errorMessage,
      );

      if (result.success) {
        await this.remindersService.markAsSent(reminder._id.toString());
        this.logger.log(
          `Reminder ${reminder._id} sent successfully via ${reminder.channel}`,
        );
      } else {
        this.logger.error(
          `Reminder ${reminder._id} failed: ${result.errorMessage}`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Error processing reminder ${reminder._id}: ${error.message}`,
      );
    }
  }

  private async sendEmailReminder(
    user: any,
    auction: any,
    reminder: ReminderDocument,
  ): Promise<{ success: boolean; errorMessage?: string }> {
    try {
      const payload: ReminderEmailPayload = {
        userName: user.name,
        auctionTitle: auction?.title ?? null,
        auctionCode: auction?.code ?? '',
        auctionCity: auction?.address?.city ?? null,
        auctionState: auction?.address?.state ?? null,
        auctionDetailsUrl: auction?.detailsUrl ?? null,
        description: reminder.description ?? null,
      };

      await this.emailService.sendReminderEmail(user.email, payload);
      return { success: true };
    } catch (error: any) {
      return { success: false, errorMessage: error.message };
    }
  }
}
