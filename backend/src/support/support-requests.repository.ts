// SPEC-009 BR-009-06..BR-009-12 / AR-08, AR-12: the only file that touches the `supportRequests`
// model. The requester's own requests are the ACCOUNT'S data (BR-002-02): the requester-side methods
// are AccountScopedRepository's (the scope is `userId` = the session's account, and a support grant's
// view is refused on every path), so another account's request is the same not-found as a missing one
// (AR-14, BR-002-12). What the platform itself must do across accounts (the grant's source, the mail
// outbox, the purge) has its own methods, named for what they are and taking no AccessContext, so a
// request handler has nothing to reach them with by accident.
//
// Every transition is ONE conditional update on the state it expects, so a race (a withdrawal against
// a grant, two delivery workers, a closure against a retry) ends in one valid state.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, type Types } from 'mongoose';
import type { AccessContext } from '../access/access-context.js';
import {
  AccountScopedRepository,
  type NewAccountRecord,
} from '../access/account-scoped.repository.js';
import { isObjectIdString } from '../access/owner-filter.js';
import { serverOperators } from '../common/mongo/query-safety.js';
import { type PageRequest, skipOf } from '../common/pagination/paginated.js';
import type { MailKind } from './domain/mail-outbox.js';
import type { SupportRequestStatus } from './domain/support-request.js';
import { SupportRequestEntity } from './schemas/support-request.schema.js';

/** A support request as the services read it: a plain value (AR-09), never a hydrated document. */
export interface SupportRequestRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  protocol: string;
  subject: string;
  message: string;
  allowDataAccess: boolean;
  dataAccessWithdrawnAt?: Date;
  status: SupportRequestStatus;
  closedAt?: Date;
  closedBy?: Types.ObjectId;
  confirmationSentAt?: Date;
  confirmationSkippedAt?: Date;
  teamNoticeSentAt?: Date;
  teamNoticeSkippedAt?: Date;
  mailAttempts: number;
  mailNextAttemptAt?: Date;
  mailClaimToken?: string;
  mailClaimUntil?: Date;
  mailGaveUpAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** What a new request is made of; the account, id and timestamps come from the repository. */
export interface NewSupportRequest {
  readonly protocol: string;
  readonly subject: string;
  readonly message: string;
  readonly allowDataAccess: boolean;
  /**
   * The time the request is opened, from the injected Clock (AR-24). It is `createdAt` (the date the
   * requester sees, BR-009-06) and the moment the first delivery round is due: the request's emails
   * are tried at once.
   */
  readonly openedAt: Date;
}

/** How a delivery round ends (see `releaseClaimByJob`). */
export type ClaimRelease =
  /** Nothing is owed any more. */
  | { readonly kind: 'done' }
  /** A mail failed: try again at `retryAt`, `failedRounds` rounds have failed so far. */
  | { readonly kind: 'retry'; readonly failedRounds: number; readonly retryAt: Date }
  /** The retries ran out. */
  | { readonly kind: 'give_up'; readonly failedRounds: number; readonly gaveUpAt: Date };

/** The settled-state field a delivered or skipped mail sets. */
const SETTLED_FIELD = {
  confirmation: { sent: 'confirmationSentAt', skipped: 'confirmationSkippedAt' },
  team_notice: { sent: 'teamNoticeSentAt', skipped: 'teamNoticeSkippedAt' },
} as const satisfies Record<MailKind, { sent: string; skipped: string }>;

/** The claim fields every end of a delivery round removes. */
const CLEAR_CLAIM = { mailClaimToken: '', mailClaimUntil: '' } as const;

@Injectable()
export class SupportRequestsRepository extends AccountScopedRepository<SupportRequestRecord> {
  private readonly entities: Model<SupportRequestEntity>;

  constructor(@InjectModel(SupportRequestEntity.name) model: Model<SupportRequestEntity>) {
    super(model as unknown as Model<SupportRequestRecord>);
    this.entities = model;
  }

  // --- The requester's side: the account's own requests (BR-009-09) ---

  /** BR-009-06: stores a request of the session's account, open, with nothing delivered yet. */
  createFor(ctx: AccessContext, request: NewSupportRequest): Promise<SupportRequestRecord> {
    // Mongoose keeps a `createdAt` / `updatedAt` it is given instead of reading the system clock, so
    // the date the requester sees is the injected Clock's (AR-24). The base type leaves the two out
    // of a new record, hence the cast.
    const record = {
      protocol: request.protocol,
      subject: request.subject,
      message: request.message,
      allowDataAccess: request.allowDataAccess,
      status: 'open',
      mailAttempts: 0,
      mailNextAttemptAt: request.openedAt,
      createdAt: request.openedAt,
      updatedAt: request.openedAt,
    } as NewAccountRecord<SupportRequestRecord>;
    return this.create(ctx, record);
  }

  /** AR-35: one page of the account's requests, newest first, and how many it has. */
  async pageOf(
    ctx: AccessContext,
    page: PageRequest,
  ): Promise<{ items: SupportRequestRecord[]; total: number }> {
    const [items, total] = await Promise.all([
      this.find(
        ctx,
        {},
        { sort: { createdAt: -1, _id: -1 }, skip: skipOf(page), limit: page.pageSize },
      ),
      this.count(ctx),
    ]);
    return { items, total };
  }

  /**
   * BR-009-08: ends the permission of an OPEN request of the account that has one in force, in one
   * conditional update (so it never overwrites an earlier withdrawal date, and never touches a closed
   * request). True when it did; false for every other case (the caller re-reads to tell which).
   */
  async markDataAccessWithdrawn(ctx: AccessContext, id: string, at: Date): Promise<boolean> {
    if (!isObjectIdString(id)) return false;
    const result = await this.entities
      .updateOne(
        this.ownedBy(ctx, {
          _id: { $eq: id },
          status: { $eq: 'open' },
          allowDataAccess: { $eq: true },
          dataAccessWithdrawnAt: serverOperators({ $exists: false }),
        }),
        { $set: { dataAccessWithdrawnAt: at } },
      )
      .exec();
    return result.matchedCount > 0;
  }

  // --- SPEC-010: the export and the purge ---

  /** BR-010-08: every request of the account, newest first, for the export (paged, complete) and "my data". */
  findAllForExport(
    ctx: AccessContext,
    limit?: number,
  ): Promise<{ items: SupportRequestRecord[]; total: number }> {
    return this.findPagedForExport(ctx, { createdAt: -1, _id: -1 }, limit);
  }

  /** AR-12 / AR-31 / BR-010-15: JOB ONLY. Deletes every request of one closed account; idempotent. */
  purgeAccountByJob(accountId: string): Promise<number> {
    return this.deleteAllOfAccountByJob(accountId);
  }

  // --- The platform's side: across accounts, named for what they are (AR-12) ---

  /**
   * AR-12 / BR-002-24: a request by id whoever opened it, or null (a malformed id is null too). For
   * the support grant's source and for the delivery of its emails; never reachable from a requester's route.
   */
  async findByIdAcrossAccounts(id: string): Promise<SupportRequestRecord | null> {
    if (!isObjectIdString(id)) return null;
    const [found] = await this.findAcrossAccountsForJob({ _id: { $eq: id } }, { limit: 1 });
    return found ?? null;
  }

  /**
   * BR-009-07: takes the delivery of ONE request, or of the oldest due one when `id` is absent, in one
   * conditional update: the request must owe an email whose time has come and be held by nobody (or by
   * a lease that ran out). So two workers, or a worker and the request's own first attempt, never both
   * send: whoever's update matches holds the claim until `until`. Null when there is nothing to take.
   */
  async claimDeliveryByJob(
    id: string | undefined,
    token: string,
    now: Date,
    until: Date,
  ): Promise<SupportRequestRecord | null> {
    if (id !== undefined && !isObjectIdString(id)) return null;
    const row = await this.entities
      .findOneAndUpdate(
        {
          ...(id === undefined ? {} : { _id: { $eq: id } }),
          mailNextAttemptAt: serverOperators({ $lte: now }),
          $or: [
            { mailClaimUntil: serverOperators({ $exists: false }) },
            { mailClaimUntil: serverOperators({ $lte: now }) },
          ],
        },
        { $set: { mailClaimToken: token, mailClaimUntil: until } },
        { sort: { mailNextAttemptAt: 1, _id: 1 }, returnDocument: 'after' },
      )
      .lean()
      .exec();
    return row ? (row as unknown as SupportRequestRecord) : null;
  }

  /**
   * Records that a mail was delivered or skipped on purpose, only for the worker that still holds the
   * claim (a lease that ran out and was taken over matches nothing). True when it was recorded.
   */
  async markMailSettledByJob(
    id: string,
    token: string,
    kind: MailKind,
    outcome: 'sent' | 'skipped',
    at: Date,
  ): Promise<boolean> {
    const result = await this.entities
      .updateOne(
        { _id: { $eq: id }, mailClaimToken: { $eq: token } },
        { $set: { [SETTLED_FIELD[kind][outcome]]: at } },
      )
      .exec();
    return result.matchedCount > 0;
  }

  /** Ends the delivery round of the worker holding `token`: nothing owed, a retry, or the end of retries. */
  async releaseClaimByJob(id: string, token: string, release: ClaimRelease): Promise<boolean> {
    const changes =
      release.kind === 'done'
        ? { $unset: { ...CLEAR_CLAIM, mailNextAttemptAt: '' } }
        : release.kind === 'retry'
          ? {
              $set: { mailAttempts: release.failedRounds, mailNextAttemptAt: release.retryAt },
              $unset: CLEAR_CLAIM,
            }
          : {
              $set: { mailAttempts: release.failedRounds, mailGaveUpAt: release.gaveUpAt },
              $unset: { ...CLEAR_CLAIM, mailNextAttemptAt: '' },
            };
    const result = await this.entities
      .updateOne({ _id: { $eq: id }, mailClaimToken: { $eq: token } }, changes)
      .exec();
    return result.matchedCount > 0;
  }
}
