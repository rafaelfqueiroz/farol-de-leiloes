// SPEC-002 BR-002-02 / AR-08 / AR-12: the base of every repository of an account's OWN data —
// favorites, saved filters, reminders and their notification logs, later alerts, loose simulations
// and notification preferences. It belongs to that account alone: the scope is `userId` equal to
// the request's account, and nothing else. No office, membership or client link ever reaches it, so
// an office never sees its clients' own data (DL-002-08), and an admin sees only its own (BR-002-23).
//
// Each public method takes the request's AccessContext, never an account id (BR-002-11). Jobs that
// work across accounts (the reminders scheduler) use the protected `...AcrossAccounts...` methods a
// subclass exposes under a name that says so (AR-12); they take no context at all.
//
// A support access grant opens CLIENT data only (BR-002-24, BR-002-25, DL-002-04), never an
// account's own data (BR-002-02, BR-002-23). Its view (`ctx.viaSupportGrant`, built only by
// AccessContextFactory.supportGrantView) is refused here on EVERY path, before the database is
// touched (fail closed):
//   reads   `find`, `count`, `findOne`, `findById` and every subclass query built on `ownedBy`
//           throw the module's not-found — lists and counts included, never an empty answer, so a
//           caller cannot mistake the refusal for an account with no data;
//   writes  `create`, `updateById`, `deleteMany`, `deleteById` throw FORBIDDEN, as for any
//           read-only context (the view is read-only, BR-002-25; no record is involved).
// Nothing is read, so a grant route that tried logs nothing (BR-002-27).
import type { ClientSession, Model } from 'mongoose';
import type { ErrorCode } from '../common/errors/codes.js';
import { DomainError } from '../common/errors/domain-error.js';
import type { AccessContext } from './access-context.js';
import { isObjectIdString } from './owner-filter.js';

/** The field every account-owned record carries. */
export interface AccountRecord {
  userId: unknown;
}

/** What a caller gives a new record: everything but its account, its id and its timestamps. */
export type NewAccountRecord<TRecord> = Omit<TRecord, 'userId' | '_id' | 'createdAt' | 'updatedAt'>;

/** What an update may set: never the account or the id. */
export type AccountRecordChanges<TRecord> = Partial<NewAccountRecord<TRecord>>;

export interface AccountFindOptions {
  /** Server-chosen sort, never a field name from a request without an allowlist (SC-10). */
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
  /** Server-chosen projection. */
  select?: string;
  session?: ClientSession;
}

type UntypedModel = Model<Record<string, unknown>>;
type Filter = Record<string, unknown>;

const PROTECTED_FIELDS = ['_id', 'userId'];

/** BR-002-25: a read-only context (a grant's view) writes no account data (FORBIDDEN). */
function assertMayWrite(ctx: AccessContext): void {
  if (ctx.readOnly) throw new DomainError('FORBIDDEN');
}

/** BR-002-02 / SC-10: a payload never names the account, the id or an operator (programming error). */
function assertNoProtectedFields(payload: object, what: string): void {
  for (const key of Object.keys(payload)) {
    const root = key.split('.')[0] ?? key;
    if (PROTECTED_FIELDS.includes(root) || key.startsWith('$')) {
      throw new Error(`${what} may not set "${key}" (BR-002-02, AR-12)`);
    }
  }
}

export abstract class AccountScopedRepository<TRecord extends AccountRecord> {
  private readonly records: UntypedModel;

  protected constructor(
    /** For subclass queries that need more (populate); they filter with `ownedBy(ctx, ...)`. */
    protected readonly model: Model<TRecord>,
    /** The module's own not-found code, answered alike for missing and foreign ids (AR-14). */
    protected readonly notFound: ErrorCode = 'NOT_FOUND',
  ) {
    if (!model.schema.path('userId')) {
      throw new Error(`${model.modelName} has no userId: it is not account-owned (BR-002-02)`);
    }
    this.records = model as unknown as UntypedModel;
  }

  /** The account's records matching `filter`. */
  async find(
    ctx: AccessContext,
    filter: Filter = {},
    options: AccountFindOptions = {},
  ): Promise<TRecord[]> {
    this.refuseGrantView(ctx);
    let query = this.records.find(this.ownedBy(ctx, filter), undefined, {
      session: options.session,
    });
    if (options.select) query = query.select(options.select);
    if (options.sort) query = query.sort(options.sort);
    if (options.skip !== undefined) query = query.skip(options.skip);
    if (options.limit !== undefined) query = query.limit(options.limit);
    return (await query.lean().exec()) as TRecord[];
  }

  /** How many of the account's records match `filter` (counts leak like lists, TS-15). */
  async count(ctx: AccessContext, filter: Filter = {}): Promise<number> {
    this.refuseGrantView(ctx);
    return this.records.countDocuments(this.ownedBy(ctx, filter)).exec();
  }

  /** One of the account's records matching `filter`, or null. */
  async findOne(ctx: AccessContext, filter: Filter): Promise<TRecord | null> {
    this.refuseGrantView(ctx);
    const found = await this.records.findOne(this.ownedBy(ctx, filter)).lean().exec();
    return found as TRecord | null;
  }

  /** One of the account's records by id, or null — the same for another account's and a missing id. */
  async findById(ctx: AccessContext, id: string): Promise<TRecord | null> {
    this.refuseGrantView(ctx);
    if (!isObjectIdString(id)) return null;
    return this.findOne(ctx, { _id: { $eq: id } });
  }

  /** Inserts a record of the request's account; the payload never names the account (BR-002-11). */
  async create(ctx: AccessContext, record: NewAccountRecord<TRecord>): Promise<TRecord> {
    assertMayWrite(ctx);
    assertNoProtectedFields(record, 'A new account record');
    const [created] = await this.records.create([{ ...record, userId: ctx.accountId }]);
    if (!created) throw new Error('MongoDB created no document');
    return created.toObject() as unknown as TRecord;
  }

  /**
   * Sets `changes` on one of the account's records, in one conditional operation also matching
   * `condition` (e.g. still pending), and answers it as stored after. Not the account's, missing,
   * malformed or not matching `condition`: the module's not-found (AR-14).
   */
  async updateById(
    ctx: AccessContext,
    id: string,
    changes: AccountRecordChanges<TRecord>,
    condition: Filter = {},
  ): Promise<TRecord> {
    assertMayWrite(ctx);
    assertNoProtectedFields(changes, 'An update of an account record');
    if (isObjectIdString(id)) {
      const updated = await this.records
        .findOneAndUpdate(
          this.ownedBy(ctx, { $and: [{ _id: { $eq: id } }, condition] }),
          { $set: changes },
          { returnDocument: 'after', runValidators: true },
        )
        .lean()
        .exec();
      if (updated) return updated as TRecord;
    }
    throw new DomainError(this.notFound);
  }

  /** Deletes the account's records matching `filter`; answers how many. */
  async deleteMany(ctx: AccessContext, filter: Filter): Promise<number> {
    assertMayWrite(ctx);
    const result = await this.records.deleteMany(this.ownedBy(ctx, filter)).exec();
    return result.deletedCount;
  }

  /**
   * Deletes one of the account's records also matching `condition`; the module's not-found when
   * none matched (another account's, missing or malformed id, AR-14).
   */
  async deleteById(ctx: AccessContext, id: string, condition: Filter = {}): Promise<void> {
    assertMayWrite(ctx);
    if (isObjectIdString(id)) {
      const deleted = await this.deleteMany(ctx, { $and: [{ _id: { $eq: id } }, condition] });
      if (deleted > 0) return;
    }
    throw new DomainError(this.notFound);
  }

  /**
   * `filter` within the request's account: `userId` equal to the context's account and nothing
   * else, combined with `$and` so `filter` cannot widen it. Subclasses build every query they make
   * on the model with this. A support grant's view is refused here too (the module's not-found),
   * so a subclass query cannot read an account's own data under a grant (BR-002-02, BR-002-23).
   */
  protected ownedBy(ctx: AccessContext, filter: Filter = {}): Filter {
    this.refuseGrantView(ctx);
    return { $and: [{ userId: { $eq: ctx.accountId } }, filter] };
  }

  /** BR-002-02 / BR-002-23 / DL-002-04: a grant opens client data, never an account's own. */
  private refuseGrantView(ctx: AccessContext): void {
    if (ctx.viaSupportGrant) throw new DomainError(this.notFound);
  }

  /**
   * AR-12: UNSCOPED read across every account, for a job (the reminders scheduler) that delivers
   * each record only to its own account (BR-002-29). Never called from a request handler.
   */
  protected async findAcrossAccountsForJob(
    filter: Filter,
    options: AccountFindOptions = {},
  ): Promise<TRecord[]> {
    let query = this.records.find(filter);
    if (options.sort) query = query.sort(options.sort);
    if (options.limit !== undefined) query = query.limit(options.limit);
    return (await query.lean().exec()) as TRecord[];
  }

  /** AR-12: UNSCOPED update of the records `filter` matches, for a job; answers how many. */
  protected async updateAcrossAccountsForJob(
    filter: Filter,
    changes: AccountRecordChanges<TRecord>,
  ): Promise<number> {
    assertNoProtectedFields(changes, 'A job update of an account record');
    const result = await this.records.updateMany(filter, { $set: changes }).exec();
    return result.modifiedCount;
  }

  /**
   * AR-12: a record a JOB writes for an account it read from another record of that same account
   * (e.g. the notification log of a reminder), never from a request (BR-002-29).
   */
  protected async createForAccountByJob(
    accountId: string,
    record: NewAccountRecord<TRecord>,
  ): Promise<void> {
    assertNoProtectedFields(record, 'A job record');
    await this.records.create([{ ...record, userId: accountId }]);
  }
}
