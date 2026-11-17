// SPEC-002 AR-11 / AR-12: the base of every repository of an OWNED collection (client data: client
// records, investor profiles, journeys and everything inside them). Each public method takes the
// request's AccessContext — never an owner id (BR-002-11) — and merges the owner filter derived from
// it, so a forgotten filter in one endpoint cannot leak another office's data.
//
//   reads    the owners the account conducts (ctx.conductedOwners(): its offices, read-only ones
//            included, D-47, and itself when self-advised); none ⇒ nothing, never "no filter"
//   writes   one conditional operation filtered by the owners it may WRITE now
//            (ctx.writableOwners(), BR-002-30); a miss is OFFICE_READ_ONLY only when the record is
//            the caller's own (so it leaks nothing), else the same not-found as a missing id
//            (BR-002-12, AR-14)
//   create   the owner comes from the context (AccessContext.resolveActingOwner), never the payload
//            (BR-002-01, BR-002-11)
//   updates  never touch ownerType, ownerId or _id: ownership never moves (BR-002-01)
//
// Investor reads (BR-002-05/07) and cross-owner job reads (AR-12) are protected methods a subclass
// exposes deliberately, under names that say what they are.
import type { ClientSession, Model } from 'mongoose';
import type { ErrorCode } from '../common/errors/codes.js';
import { DomainError } from '../common/errors/domain-error.js';
import type { AccessContext, ActingOwner, Owner } from './access-context.js';
import { investorScope } from './domain/investor-scope.js';
import {
  type InvestorScopeFields,
  investorScopeFilter,
  isObjectIdString,
  JOURNEY_INVESTOR_FIELDS,
  ownersFilter,
} from './owner-filter.js';

/** The two fields every owned record carries (AR-11). */
export interface OwnedRecord {
  ownerType: Owner['ownerType'];
  ownerId: unknown;
}

/** The fields a caller may give a new record: everything but its owner, id and timestamps. */
export type NewOwnedRecord<TRecord> = Omit<
  TRecord,
  'ownerType' | 'ownerId' | '_id' | 'createdAt' | 'updatedAt'
>;

/** The fields an update may set: never the owner or the id (BR-002-01). */
export type OwnedRecordChanges<TRecord> = Partial<NewOwnedRecord<TRecord>>;

export interface ScopedFindOptions {
  /** Server-chosen sort; never a field name from a request without an allowlist (SC-10). */
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
  session?: ClientSession;
}

export interface ScopedWriteOptions {
  /** SPEC-016: the write is part of a transaction (e.g. with an OwnerCounterRepository acquire). */
  session?: ClientSession;
}

export interface ScopedCreateOptions extends ScopedWriteOptions {
  /**
   * The owner chosen by `ctx.resolveActingOwner(requestedOfficeId)` when the account conducts
   * several owners; without it the context's only owner is used (BR-002-11).
   */
  actingOwner?: ActingOwner;
}

/** The model seen without its record type: filters here are built from server state only. */
type UntypedModel = Model<Record<string, unknown>>;
type Filter = Record<string, unknown>;

const PROTECTED_FIELDS = ['_id', 'ownerType', 'ownerId'];

/**
 * BR-002-01 / SC-10: a payload never names the owner or the id, nor an operator. Payloads are built
 * by services from whitelisted DTO fields, so this is a programming error, not a client answer.
 */
function assertNoProtectedFields(payload: object, what: string): void {
  for (const key of Object.keys(payload)) {
    const root = key.split('.')[0] ?? key;
    if (PROTECTED_FIELDS.includes(root) || key.startsWith('$')) {
      throw new Error(`${what} may not set "${key}" (BR-002-01, AR-12)`);
    }
  }
}

export abstract class OwnerScopedRepository<TRecord extends OwnedRecord> {
  private readonly records: UntypedModel;

  protected constructor(
    model: Model<TRecord>,
    /** The module's own not-found code, answered alike for missing and foreign ids (AR-14). */
    protected readonly notFound: ErrorCode = 'NOT_FOUND',
  ) {
    // AR-11: an owned collection is one whose schema has both owner paths.
    if (!model.schema.path('ownerType') || !model.schema.path('ownerId')) {
      throw new Error(`${model.modelName} has no ownerType/ownerId: it is not owned (AR-11)`);
    }
    this.records = model as unknown as UntypedModel;
  }

  /** The records of the owners the account conducts that also match `filter`. */
  async find(
    ctx: AccessContext,
    filter: Filter = {},
    options: ScopedFindOptions = {},
  ): Promise<TRecord[]> {
    return this.runFind(this.readable(ctx, filter), options);
  }

  /** How many records `find` would return without paging (lists and counts leak alike, TS-15). */
  async count(ctx: AccessContext, filter: Filter = {}): Promise<number> {
    return this.records.countDocuments(this.readable(ctx, filter)).exec();
  }

  /** One record of an owner the account conducts, or null — the same for foreign and missing. */
  async findById(ctx: AccessContext, id: string): Promise<TRecord | null> {
    if (!isObjectIdString(id)) return null;
    return this.records
      .findOne(this.readable(ctx, { _id: { $eq: id } }))
      .lean<TRecord>()
      .exec();
  }

  /**
   * Inserts a record owned by the acting owner (BR-002-01, BR-002-11). Refused when the payload
   * names an owner or an id (programming error), when the acting owner belongs to another request,
   * and when the owner may not be written to now (OFFICE_READ_ONLY, BR-002-30).
   */
  async create(
    ctx: AccessContext,
    record: NewOwnedRecord<TRecord>,
    options: ScopedCreateOptions = {},
  ): Promise<TRecord> {
    assertNoProtectedFields(record, 'A new owned record');
    const acting = options.actingOwner ?? ctx.resolveActingOwner(undefined, this.notFound);
    if (acting.context !== ctx) {
      throw new Error('The acting owner was resolved for another request (BR-002-11)');
    }
    if (!ctx.canWriteOwner(acting.owner)) throw new DomainError('OFFICE_READ_ONLY');
    const [created] = await this.records.create(
      [{ ...record, ownerType: acting.owner.ownerType, ownerId: acting.owner.ownerId }],
      { session: options.session },
    );
    if (!created) throw new Error('MongoDB created no document');
    return created.toObject() as TRecord;
  }

  /**
   * Sets `changes` on one record of an owner the account may write to, in one conditional
   * operation (BR-002-30), and answers the record as stored after it.
   */
  async updateById(
    ctx: AccessContext,
    id: string,
    changes: OwnedRecordChanges<TRecord>,
    options: ScopedWriteOptions = {},
  ): Promise<TRecord> {
    assertNoProtectedFields(changes, 'An update of an owned record');
    if (isObjectIdString(id)) {
      const updated = await this.records
        .findOneAndUpdate(
          this.writable(ctx, id),
          { $set: changes },
          { returnDocument: 'after', runValidators: true, session: options.session },
        )
        .lean<TRecord>()
        .exec();
      if (updated) return updated;
    }
    return this.refuseWrite(ctx, id);
  }

  /** Deletes one record of an owner the account may write to and answers it as it was. */
  async deleteById(
    ctx: AccessContext,
    id: string,
    options: ScopedWriteOptions = {},
  ): Promise<TRecord> {
    if (isObjectIdString(id)) {
      const deleted = await this.records
        .findOneAndDelete(this.writable(ctx, id), { session: options.session })
        .lean<TRecord>()
        .exec();
      if (deleted) return deleted;
    }
    return this.refuseWrite(ctx, id);
  }

  /**
   * BR-002-05 / BR-002-07: the records the account reads as their investor, across every office
   * that conducts one for them, plus its own self-advised ones. Protected: only a collection that
   * has an investor (SPEC-016 journeys) exposes it, on a read-only route (BR-002-06).
   */
  protected findAsInvestor(
    ctx: AccessContext,
    filter: Filter = {},
    options: ScopedFindOptions = {},
    fields: InvestorScopeFields = JOURNEY_INVESTOR_FIELDS,
  ): Promise<TRecord[]> {
    return this.runFind(this.investorReadable(ctx, filter, fields), options);
  }

  /** The count of `findAsInvestor` without paging. */
  protected countAsInvestor(
    ctx: AccessContext,
    filter: Filter = {},
    fields: InvestorScopeFields = JOURNEY_INVESTOR_FIELDS,
  ): Promise<number> {
    return this.records.countDocuments(this.investorReadable(ctx, filter, fields)).exec();
  }

  /**
   * AR-12: UNSCOPED read across every owner, for a job (Radar, digests) that then delivers each
   * owner's data only to accounts entitled to it at delivery time (BR-002-29). Never called from a
   * request handler; every caller is reviewed as such.
   */
  protected findAcrossOwnersForJob(
    filter: Filter,
    options: ScopedFindOptions = {},
  ): Promise<TRecord[]> {
    return this.runFind(filter, options);
  }

  /** `filter` within the owners the account conducts; `$and` so `filter` cannot widen it. */
  protected readable(ctx: AccessContext, filter: Filter): Filter {
    return { $and: [ownersFilter(ctx.conductedOwners()), filter] };
  }

  private investorReadable(
    ctx: AccessContext,
    filter: Filter,
    fields: InvestorScopeFields,
  ): Filter {
    const scope = investorScope({
      accountId: ctx.accountId,
      isAdmin: ctx.isAdmin,
      clientLinks: ctx.clientLinks,
    });
    return { $and: [investorScopeFilter(scope, fields), filter] };
  }

  private writable(ctx: AccessContext, id: string): Filter {
    return {
      $and: [ownersFilter(ctx.writableOwners()), { _id: { $eq: id } }],
    };
  }

  /**
   * A write matched nothing. The caller's own record of a read-only owner is OFFICE_READ_ONLY
   * (BR-002-30; it is theirs, so this says nothing new); anything else — another owner's record, a
   * missing or malformed id — is the module's not-found, identical in status and body (BR-002-12).
   */
  private async refuseWrite(ctx: AccessContext, id: string): Promise<never> {
    if (isObjectIdString(id)) {
      const own = await this.records.exists(this.readable(ctx, { _id: { $eq: id } })).exec();
      if (own) throw new DomainError('OFFICE_READ_ONLY');
    }
    throw new DomainError(this.notFound);
  }

  private async runFind(filter: Filter, options: ScopedFindOptions): Promise<TRecord[]> {
    let query = this.records.find(filter, undefined, { session: options.session });
    if (options.sort) query = query.sort(options.sort);
    if (options.skip !== undefined) query = query.skip(options.skip);
    if (options.limit !== undefined) query = query.limit(options.limit);
    return (await query.lean().exec()) as TRecord[];
  }
}
