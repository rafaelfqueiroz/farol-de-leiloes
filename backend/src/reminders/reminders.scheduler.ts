import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RemindersService } from './reminders.service.js';
import { UsersService } from '../users/users.service.js';
import { EmailService } from '../email/email.service.js';
import { SmsService } from '../notifications/sms.service.js';
import { WhatsAppService } from '../notifications/whatsapp.service.js';
import { JobExecutionService } from '../common/services/job-execution.service.js';
import { RunMode } from '../common/job-execution.js';
import { ReminderChannel } from './schemas/reminder.schema.js';
import { PopulatedReminder, ReminderAuction } from './interfaces/reminder.interface.js';
import { ReminderEmailPayload } from './templates/reminder.template.js';
import schedulerConfig, { SchedulerConfig } from '../config/scheduler.config.js';
import { logSafeError } from '../common/errors/log-safe-error.js';
import { jobErrorCode } from '../common/services/job-error-code.js';
import { BRASILIA_TIME_ZONE } from '../common/clock/brasilia-time.js';
import { InJobContext } from '../common/observability/job-context.js';

export const REMINDERS_JOB = 'reminders-processor';

@Injectable()
export class RemindersScheduler implements OnModuleInit {
  private readonly logger = new Logger(RemindersScheduler.name);
  private readonly jobName = REMINDERS_JOB;

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

  // AR-25: the zone is explicit on every cron, even one that runs every 15 minutes.
  @Cron('*/15 * * * *', { timeZone: BRASILIA_TIME_ZONE })
  @InJobContext(REMINDERS_JOB) // AR-46
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
    } catch (error) {
      this.logger.error(`Failed to process reminders: ${jobErrorCode(error)}`);
    }
  }

  private async processReminder(reminder: PopulatedReminder): Promise<void> {
    try {
      const user = await this.usersService.findByIdFull(reminder.userId.toString());
      if (!user) {
        // The account is gone for good (never comes back): the reminder can never be sent.
        await this.remindersService.markAsCancelled(reminder._id.toString());
        this.logger.warn(`User not found for reminder ${reminder._id}`);
        return;
      }
      // SPEC-010 BR-010-14 / BR-001-16, SPEC-009 BR-009-15, BR-009-17: nothing is sent to an account
      // that is not active, and a reminder found DUE for one is CANCELLED, whatever the status: a
      // closed account never comes back, and a deactivated one's reminder whose time has passed must
      // never be sent late after a reactivation (it is not "pending" any more, so reactivating
      // cannot revive it) and must not stay in the due window, re-read every run, where it would
      // crowd out other accounts' reminders. A reminder not yet due is untouched: it is read only
      // once its time comes, so the account's future reminders survive a deactivation.
      if ((user.status ?? 'active') !== 'active') {
        await this.remindersService.markAsCancelled(reminder._id.toString());
        this.logger.warn(`Reminder ${reminder._id} cancelled, not sent: the account is not active`);
        return;
      }

      const auction = reminder.auction;

      let result: { success: boolean; errorMessage?: string };
      let recipient: string;

      switch (reminder.channel) {
        case ReminderChannel.EMAIL:
          recipient = user.email;
          result = await this.sendEmailReminder(user, auction, reminder);
          break;

        case ReminderChannel.SMS:
          // The phone is checked when the reminder is saved but can be removed later (DV-03).
          if (!user.phone) {
            this.logger.error(`Error processing reminder ${reminder._id}: user has no phone`);
            return;
          }
          recipient = user.phone;
          result = await this.smsService.sendReminderSms(user.phone, {
            auctionTitle: auction?.title || auction?.code || '',
            auctionCode: auction?.code || '',
            auctionCity: auction?.address?.city ?? null,
            auctionState: auction?.address?.state ?? null,
            description: reminder.description ?? null,
          });
          break;

        case ReminderChannel.WHATSAPP:
          if (!user.phone) {
            this.logger.error(`Error processing reminder ${reminder._id}: user has no phone`);
            return;
          }
          recipient = user.phone;
          result = await this.whatsAppService.sendReminderWhatsApp(user.phone, {
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
        this.logger.log(`Reminder ${reminder._id} sent successfully via ${reminder.channel}`);
      } else {
        this.logger.error(`Reminder ${reminder._id} failed: ${result.errorMessage}`);
      }
    } catch (error) {
      this.logger.error(`Error processing reminder ${reminder._id}: ${jobErrorCode(error)}`);
    }
  }

  private async sendEmailReminder(
    user: { name: string; email: string },
    auction: ReminderAuction,
    reminder: PopulatedReminder,
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
        scheduledAt: reminder.scheduledAt, // BR-003-23: the email shows it in Brasília time
      };

      await this.emailService.sendReminderEmail(user.email, payload);
      return { success: true };
    } catch (error) {
      return { success: false, errorMessage: logSafeError(error) }; // SC-15: SMTP errors quote addresses
    }
  }
}
