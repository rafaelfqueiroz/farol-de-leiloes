// AR-08: the only file that touches the notification log model. A log is the account's own data
// (SPEC-002 BR-002-02), written only by the reminders scheduler for the account of the reminder it
// delivered (BR-002-29); no API reads it. The write is a named cross-account job method (AR-12).
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import { AccountScopedRepository } from '../access/account-scoped.repository.js';
import type { AccessContext } from '../access/access-context.js';
import type { ReminderChannel } from './schemas/reminder.schema.js';
import { NotificationLog } from './schemas/notification-log.schema.js';

/** One delivery attempt of a reminder, as stored. */
export interface NotificationLogRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  reminderId: Types.ObjectId;
  channel: ReminderChannel;
  recipient: string;
  success: boolean;
  errorMessage?: string;
  createdAt?: Date;
}

/** What the scheduler records for one attempt. */
export interface DeliveryAttempt {
  reminderId: string;
  channel: ReminderChannel;
  recipient: string;
  success: boolean;
  errorMessage?: string;
}

@Injectable()
export class NotificationLogsRepository extends AccountScopedRepository<NotificationLogRecord> {
  constructor(@InjectModel(NotificationLog.name) model: Model<NotificationLog>) {
    super(model as unknown as Model<NotificationLogRecord>);
  }

  /** SPEC-010 BR-010-08: every delivery attempt to the account, newest first, for the export. */
  findAllForExport(ctx: AccessContext): Promise<NotificationLogRecord[]> {
    return this.find(ctx, {}, { sort: { createdAt: -1, _id: -1 } });
  }

  /**
   * AR-12 / AR-31 / SPEC-010 BR-010-15: JOB ONLY. Deletes every delivery log of one closed account
   * (each holds the address or phone the message went to); idempotent. Never from a request.
   */
  purgeAccountByJob(accountId: string): Promise<number> {
    return this.deleteAllOfAccountByJob(accountId);
  }

  /**
   * AR-12 / BR-002-29: the scheduler records a delivery for the account the reminder belongs to,
   * the one it read from that same reminder.
   */
  async recordDeliveryByJob(accountId: string, attempt: DeliveryAttempt): Promise<void> {
    await this.createForAccountByJob(accountId, {
      reminderId: new Types.ObjectId(attempt.reminderId),
      channel: attempt.channel,
      recipient: attempt.recipient,
      success: attempt.success,
      errorMessage: attempt.errorMessage,
    });
  }
}
