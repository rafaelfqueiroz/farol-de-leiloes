// AR-08: the only file that touches the reminder model. Reminders are the account's own data
// (SPEC-002 BR-002-02): request paths are scoped to the request's account by
// AccountScopedRepository; the scheduler, which delivers every account's due reminders, uses the
// explicitly named cross-account methods (AR-12) and delivers each only to its own account
// (BR-002-29).
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { AccountScopedRepository } from '../access/account-scoped.repository.js';
import type { AccessContext } from '../access/access-context.js';
import { isObjectIdString } from '../access/owner-filter.js';
import { serverOperators } from '../common/mongo/query-safety.js';
import { skipOf, type PageRequest } from '../common/pagination/paginated.js';
import type { PopulatedReminder, ReminderAuction } from './interfaces/reminder.interface.js';
import { ReminderChannel, ReminderEntity, ReminderStatus } from './schemas/reminder.schema.js';

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
   * AR-12 / BR-002-29: CROSS-ACCOUNT, for the reminders scheduler only: pending reminders of every
   * account due at `now`, each delivered to its own account.
   */
  findDueAcrossAccounts(now: Date, limit: number): Promise<PopulatedReminder[]> {
    return this.reminders
      .find({ status: ReminderStatus.PENDING, scheduledAt: serverOperators({ $lte: now }) })
      .populate<{ auction: ReminderAuction }>('auction')
      .limit(limit)
      .exec();
  }

  /** AR-12: CROSS-ACCOUNT, for the reminders scheduler only: one reminder, by its id, is sent. */
  async markSentAcrossAccounts(reminderId: string): Promise<void> {
    await this.updateAcrossAccountsForJob(
      { _id: { $eq: reminderId } },
      { status: ReminderStatus.SENT },
    );
  }
}
