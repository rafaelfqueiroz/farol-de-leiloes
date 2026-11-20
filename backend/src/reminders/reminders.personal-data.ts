// SPEC-010 BR-010-08, BR-010-09, BR-010-15 / SC-27: what the reminders module holds about an account
// (the reminders, and the delivery log of each, which records the address or phone it went to), for
// the export, the "my data" view and the purge (AR-09: through its own repositories).
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../access/access-context.js';
import { listSection } from '../privacy/domain/export-document.js';
import { PersonalDataRegistry } from '../privacy/registry/personal-data-registry.js';
import type {
  CollectOptions,
  PersonalDataProvider,
} from '../privacy/registry/personal-data-provider.js';
import { NotificationLogsRepository } from './notification-logs.repository.js';
import { RemindersRepository } from './reminders.repository.js';
import { NotificationLog } from './schemas/notification-log.schema.js';
import { ReminderEntity } from './schemas/reminder.schema.js';

@Injectable()
export class RemindersPersonalData implements PersonalDataProvider {
  readonly name = 'reminders';
  readonly models = [ReminderEntity.name];

  constructor(
    registry: PersonalDataRegistry,
    private readonly reminders: RemindersRepository,
  ) {
    registry.register(this);
  }

  async collect(ctx: AccessContext, options?: CollectOptions): Promise<Record<string, unknown>> {
    const { items: found, total } = await this.reminders.findAllForExport(ctx, options?.limit);
    return listSection(
      found.map((reminder) => ({
        auctionCode: reminder.auction?.code ?? null,
        channel: reminder.channel,
        scheduledAt: reminder.scheduledAt,
        description: reminder.description ?? null,
        status: reminder.status,
        createdAt: reminder.createdAt,
      })),
      total,
    );
  }

  async purge(userId: string): Promise<{ deleted: number }> {
    return { deleted: await this.reminders.purgeAccountByJob(userId) };
  }
}

@Injectable()
export class NotificationLogsPersonalData implements PersonalDataProvider {
  readonly name = 'notificationLogs';
  readonly models = [NotificationLog.name];

  constructor(
    registry: PersonalDataRegistry,
    private readonly logs: NotificationLogsRepository,
  ) {
    registry.register(this);
  }

  async collect(ctx: AccessContext, options?: CollectOptions): Promise<Record<string, unknown>> {
    const { items: found, total } = await this.logs.findAllForExport(ctx, options?.limit);
    return listSection(
      found.map((log) => ({
        reminderId: log.reminderId.toHexString(),
        channel: log.channel,
        // The address or phone the message was sent to: the account's own data (BR-010-08).
        recipient: log.recipient,
        success: log.success,
        errorMessage: log.errorMessage ?? null,
        sentAt: log.createdAt ?? null,
      })),
      total,
    );
  }

  async purge(userId: string): Promise<{ deleted: number }> {
    return { deleted: await this.logs.purgeAccountByJob(userId) };
  }
}
