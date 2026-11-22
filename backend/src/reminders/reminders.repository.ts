// AR-08: the only file that touches the reminder model. Reminders are the account's own data
// (SPEC-002 BR-002-02): request paths are scoped to the request's account by
// AccountScopedRepository; the scheduler, which delivers every account's due reminders, uses the
// explicitly named cross-account methods (AR-12) and delivers each only to its own account
// (BR-002-29).
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { AccountScopedRepository, EXPORT_PAGE_SIZE } from '../access/account-scoped.repository.js';
import type { AccessContext } from '../access/access-context.js';
import { isObjectIdString } from '../access/owner-filter.js';
import { serverOperators } from '../common/mongo/query-safety.js';
import { skipOf, type PageRequest } from '../common/pagination/paginated.js';
import type { PopulatedReminder, ReminderAuction } from './interfaces/reminder.interface.js';
import { ReminderChannel, ReminderEntity, ReminderStatus } from './schemas/reminder.schema.js';

/** A reminder of the export: its auction reduced to the code. */
export type ExportedReminder = Omit<ReminderRecord, 'auction'> & {
  auction: { code?: string } | null;
};

/** A reminder as stored, its auction not populated. */
export interface ReminderRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  auction: Types.ObjectId;
  channel: ReminderChannel;
  scheduledAt: Date;
  description?: string;
  status: ReminderStatus;
  createdAt: Date;
}

@Injectable()
export class RemindersRepository extends AccountScopedRepository<ReminderRecord> {
  private readonly reminders: Model<ReminderEntity>;

  constructor(@InjectModel(ReminderEntity.name) model: Model<ReminderEntity>) {
    super(model as unknown as Model<ReminderRecord>, 'REMINDER_NOT_FOUND');
    this.reminders = model;
  }

  /** AR-35: one page of the account's reminders with their auctions, soonest first. */
  findPopulatedPage(ctx: AccessContext, page: PageRequest): Promise<PopulatedReminder[]> {
    return this.reminders
      .find(this.ownedBy(ctx))
      .populate<{ auction: ReminderAuction }>('auction')
      .sort({ scheduledAt: 1, _id: 1 })
      .skip(skipOf(page))
      .limit(page.pageSize)
      .exec();
  }

  /** One of the account's reminders with its auction, or null (another account's, missing). */
  async findPopulatedById(ctx: AccessContext, id: string): Promise<PopulatedReminder | null> {
    if (!isObjectIdString(id)) return null;
    return this.reminders
      .findOne(this.ownedBy(ctx, { _id: { $eq: id } }))
      .populate<{ auction: ReminderAuction }>('auction')
      .exec();
  }

  /**
   * SPEC-010 BR-010-08: every reminder of the account with the code of its auction (and nothing
   * else of it), soonest first, for the export. Scoped to the request's account like every read.
   */
  async findAllForExport(
    ctx: AccessContext,
    limit?: number,
  ): Promise<{ items: ExportedReminder[]; total: number }> {
    const read = (skip: number, take: number) =>
      this.reminders
        .find(this.ownedBy(ctx))
        .populate<{ auction: { code?: string } | null }>('auction', 'code')
        .sort({ scheduledAt: 1, _id: 1 })
        .skip(skip)
        .limit(take)
        .lean()
        .exec() as unknown as Promise<ExportedReminder[]>;
    if (limit !== undefined) {
      const [items, total] = await Promise.all([read(0, limit), this.count(ctx)]);
      return { items, total };
    }
    // Complete, but in pages: no single query is unbounded.
    const items: ExportedReminder[] = [];
    for (let skip = 0; ; skip += EXPORT_PAGE_SIZE) {
      const page = await read(skip, EXPORT_PAGE_SIZE);
      items.push(...page);
      if (page.length < EXPORT_PAGE_SIZE) break;
    }
    return { items, total: items.length };
  }

  /**
   * AR-12 / AR-31 / SPEC-010 BR-010-15: JOB ONLY. Deletes every reminder of one closed account;
   * idempotent. Never called from a request.
   */
  purgeAccountByJob(accountId: string): Promise<number> {
    return this.deleteAllOfAccountByJob(accountId);
  }

  /**
   * AR-12 / BR-002-29: CROSS-ACCOUNT, for the reminders scheduler only: pending reminders of every
   * account due at `now`, each delivered to its own account.
   */
  findDueAcrossAccounts(now: Date, limit: number): Promise<PopulatedReminder[]> {
    return (
      this.reminders
        .find({ status: ReminderStatus.PENDING, scheduledAt: serverOperators({ $lte: now }) })
        // Oldest due first (the index on scheduledAt serves it): a backlog is worked off in order and
        // no reminder waits behind newer ones.
        .sort({ scheduledAt: 1, _id: 1 })
        .populate<{ auction: ReminderAuction }>('auction')
        .limit(limit)
        .exec()
    );
  }

  /**
   * AR-12 / SPEC-010 BR-010-14: JOB ONLY (closure and purge). Cancels every PENDING reminder of one
   * closed account so the due query never selects it again; rows stay for the purge to delete.
   * Idempotent. Answers how many it cancelled.
   */
  cancelPendingOfAccountByJob(accountId: string): Promise<number> {
    return this.updateAcrossAccountsForJob(
      { userId: { $eq: accountId }, status: { $eq: ReminderStatus.PENDING } },
      { status: ReminderStatus.CANCELLED },
    );
  }

  /** AR-12 / SPEC-010: the scheduler found the reminder's account closed: it will never be sent. */
  async markCancelledAcrossAccounts(reminderId: string): Promise<void> {
    await this.updateAcrossAccountsForJob(
      { _id: { $eq: reminderId }, status: { $eq: ReminderStatus.PENDING } },
      { status: ReminderStatus.CANCELLED },
    );
  }

  /** AR-12: CROSS-ACCOUNT, for the reminders scheduler only: one reminder, by its id, is sent. */
  async markSentAcrossAccounts(reminderId: string): Promise<void> {
    await this.updateAcrossAccountsForJob(
      { _id: { $eq: reminderId } },
      { status: ReminderStatus.SENT },
    );
  }
}
