// SPEC-009 BR-009-16, BR-009-17 / AR-30, AR-08: the only file that touches the accountStatusEvents
// model. It exposes `append` and the read of one account's history, and nothing else: no update, no
// delete (held by test/structural/account-status-events-append-only.spec.ts). `append` takes the
// transaction session of the status change, so an entry exists if and only if the change committed.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type ClientSession, type Model, Types } from 'mongoose';
import { isObjectIdString } from '../access/owner-filter.js';
import type { StatusAction } from './domain/account-status-change.js';
import {
  type AccountStatusEventDocument,
  AccountStatusEventEntity,
} from './schemas/account-status-event.schema.js';

/** One entry to append; ids as hex strings (validated by the caller), `at` from the Clock. */
export interface NewAccountStatusEvent {
  readonly userId: string;
  readonly action: StatusAction;
  readonly adminUserId: string;
  readonly reason: string;
  readonly at: Date;
}

/** An entry as the service reads it: plain values, ids as hex strings (AR-09). */
export interface StoredAccountStatusEvent {
  readonly action: StatusAction;
  readonly adminUserId: string;
  readonly reason: string;
  readonly at: Date;
}

/** BR-009-13: the record shows the latest entries; a long history is cut at this many. */
export const HISTORY_LIMIT = 100;

@Injectable()
export class AccountStatusEventsRepository {
  constructor(
    @InjectModel(AccountStatusEventEntity.name)
    private readonly events: Model<AccountStatusEventDocument>,
  ) {}

  /** Inserts one entry, within the status change's transaction when `session` is given. */
  async append(entry: NewAccountStatusEvent, session?: ClientSession): Promise<void> {
    await this.events.create(
      [
        {
          userId: new Types.ObjectId(entry.userId),
          action: entry.action,
          adminUserId: new Types.ObjectId(entry.adminUserId),
          reason: entry.reason,
          at: entry.at,
        },
      ],
      session ? { session } : {},
    );
  }

  /** The account's history, newest first, at most HISTORY_LIMIT entries. */
  async historyOf(userId: string): Promise<StoredAccountStatusEvent[]> {
    if (!isObjectIdString(userId)) return [];
    const rows = await this.events
      .find({ userId: { $eq: new Types.ObjectId(userId) } })
      .sort({ at: -1, _id: -1 })
      .limit(HISTORY_LIMIT)
      .lean()
      .exec();
    return rows.map((row) => ({
      action: row.action,
      adminUserId: row.adminUserId.toHexString(),
      reason: row.reason ?? '',
      at: row.at,
    }));
  }
}
