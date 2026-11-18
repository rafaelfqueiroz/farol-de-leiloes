// SPEC-002 BR-002-13 / AR-15: the atomic plan-limit primitive. A limit check and the count it
// guards are ONE conditional update (`value < limit` → `value + 1`), so concurrent requests can
// never push an owner past its limit. `release` gives a slot back when the counted thing ends.
//
// In a transaction (SPEC-016 runs the acquire with the journey insert), the ORDER is:
//
//   await counters.ensureCounter(ctx, key, { actingOwner });   // 1. BEFORE startTransaction
//   session.startTransaction();                                 // 2.
//   ... any write of the transaction ...
//   if (!(await counters.tryAcquire(ctx, key, limit, { actingOwner, session }))) ... // 3.
//
// A transaction reads the snapshot taken at its first operation, so a counter created after that
// (outside the transaction) is invisible to it: the conditional `$inc` would match nothing and
// answer "limit reached" at zero. So `tryAcquire` with a session never creates the counter; a
// counter it cannot see is a programming error (`ensureCounter` missing or run too late), thrown
// as such, never answered as a full limit. Without a session it ensures and acquires itself.
//
// Owned (AR-11, AR-12): the owner is the request's acting owner (AccessContext.resolveActingOwner),
// never an id from the request (BR-002-11), and it must be writable now (BR-002-30).
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model, Types } from 'mongoose';
import { DomainError } from '../common/errors/domain-error.js';
import { serverOperators } from '../common/mongo/query-safety.js';
import type { AccessContext, ActingOwner, Owner } from './access-context.js';
import { OwnerScopedRepository } from './owner-scoped.repository.js';
import { OwnerCounterEntity } from './schemas/owner-counter.schema.js';

export interface CounterOptions {
  /** SPEC-016: the transaction the guarded write runs in. */
  session?: ClientSession;
}

export interface AcquireOptions extends CounterOptions {
  /** The owner chosen by ctx.resolveActingOwner(...) when the account conducts several. */
  actingOwner?: ActingOwner;
}

/** An owner as a caller may hold it: its id a string, or the ObjectId a stored record carries. */
export interface CountedOwner {
  readonly ownerType: Owner['ownerType'];
  readonly ownerId: string | Types.ObjectId;
}

/** MongoDB's duplicate-key error: another request created the same counter first. */
function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}

@Injectable()
export class OwnerCounterRepository extends OwnerScopedRepository<OwnerCounterEntity> {
  constructor(
    @InjectModel(OwnerCounterEntity.name) private readonly counters: Model<OwnerCounterEntity>,
  ) {
    super(counters);
  }

  /**
   * Creates the zero counter of `key` for the acting owner if it does not exist yet. Idempotent:
   * a duplicate-key race (two first requests at once) finds the winner's counter. Never in a
   * transaction: run it BEFORE `startTransaction` when the acquire is part of one (AR-15).
   */
  async ensureCounter(
    ctx: AccessContext,
    key: string,
    options: { actingOwner?: ActingOwner } = {},
  ): Promise<void> {
    const owner = this.writableActingOwner(ctx, options.actingOwner);
    await this.createIfMissing(this.identity(owner, key));
  }

  /**
   * The current value of `key` for the acting owner, 0 when its counter does not exist yet
   * (SPEC-012 BR-012-26, "4 of 5 journeys in progress"). A READ: it works for an office that is
   * read-only too (D-47), unlike `tryAcquire`. The owner is the request's acting owner
   * (BR-002-11), never an id from the caller.
   */
  async readValue(
    ctx: AccessContext,
    key: string,
    options: { actingOwner?: ActingOwner } = {},
  ): Promise<number> {
    const acting = options.actingOwner ?? ctx.resolveActingOwner();
    if (acting.context !== ctx) {
      throw new Error('The acting owner was resolved for another request (BR-002-11)');
    }
    if (!ctx.canReadOwner(acting.owner)) throw new DomainError('NOT_FOUND');
    const counter = await this.counters
      .findOne(this.identity(acting.owner, key))
      .select('value')
      .lean<{ value: number }>()
      .exec();
    return counter?.value ?? 0;
  }

  /**
   * Takes one slot of `key` for the acting owner when fewer than `limit` are taken, atomically
   * (BR-002-13). Answers whether it did; at the limit nothing changes. With `session`, the counter
   * must already exist (`ensureCounter` before `startTransaction`); a missing one throws.
   */
  async tryAcquire(
    ctx: AccessContext,
    key: string,
    limit: number,
    options: AcquireOptions = {},
  ): Promise<boolean> {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error('A limit is a whole number of slots, zero or more (AR-15)');
    }
    const owner = this.writableActingOwner(ctx, options.actingOwner);
    if (limit === 0) return false;

    const counter = this.identity(owner, key);
    const { session } = options;
    // Outside a transaction the counter is created here; a zero counter is harmless on its own.
    if (!session) await this.createIfMissing(counter);
    // AR-15: check and count in one conditional update. SC-10: the bound is the server's.
    const acquired = await this.counters
      .findOneAndUpdate(
        { ...counter, value: serverOperators({ $lt: limit }) },
        { $inc: { value: 1 } },
        { returnDocument: 'after', session },
      )
      .lean()
      .exec();
    if (acquired !== null) return true;
    // AR-15: in a transaction, "no match" is "limit reached" only when the counter is there.
    if (session && !(await this.counters.exists(counter).session(session).exec())) {
      throw new Error(
        'The counter does not exist in this transaction: call ensureCounter before ' +
          'startTransaction (AR-15)',
      );
    }
    return false;
  }

  /**
   * Gives back one slot of `key` for `owner` (e.g. the owner of the journey that just closed),
   * never below zero. The owner must be one the request may write to (BR-002-30); a stored
   * record's ObjectId owner is accepted as it is.
   *
   * The caller makes the release happen once per counted thing: it closes that thing with a
   * CONDITIONAL write (e.g. `status: { $ne: 'closed' }`) in the SAME transaction as the release,
   * and releases only when that write matched, so a double close cannot give a slot back twice.
   */
  async release(
    ctx: AccessContext,
    owner: CountedOwner,
    key: string,
    options: CounterOptions = {},
  ): Promise<boolean> {
    const normalised: Owner = { ownerType: owner.ownerType, ownerId: String(owner.ownerId) };
    if (!ctx.canWriteOwner(normalised)) {
      throw new Error('A slot is released only for an owner the request may write to (AR-12)');
    }
    const result = await this.counters
      .updateOne(
        { ...this.identity(normalised, key), value: serverOperators({ $gt: 0 }) },
        { $inc: { value: -1 } },
        { session: options.session },
      )
      .exec();
    return result.modifiedCount > 0;
  }

  /**
   * Gives back one slot of `key` for `owner` WITHOUT an AccessContext (AR-12: the separately named
   * unscoped method, reviewed as such). For the endings no member of the owner drives, and for an
   * owner that may no longer be written to by its members: a bid lost (D-13), a journey ended by a
   * schedule or by its investor, an office that is read-only or lapsed (BR-012-28: nothing may stop
   * a journey that ended from freeing its slot). The owner is the one the ended record carries,
   * never an id from a request. Never below zero. The caller closes the thing with a conditional
   * write in the same transaction and releases only when that write matched (see `release`).
   */
  async releaseByJob(
    owner: CountedOwner,
    key: string,
    options: CounterOptions = {},
  ): Promise<boolean> {
    const normalised: Owner = { ownerType: owner.ownerType, ownerId: String(owner.ownerId) };
    const result = await this.counters
      .updateOne(
        { ...this.identity(normalised, key), value: serverOperators({ $gt: 0 }) },
        { $inc: { value: -1 } },
        { session: options.session },
      )
      .exec();
    return result.modifiedCount > 0;
  }

  /**
   * Repairs a counter that drifted from the truth (AR-12: named, unscoped, for a daily job): sets
   * `key` for `owner` to `actual`, creating the counter if it is missing, in ONE conditional
   * update that matches only while the stored value differs. Answers the value it replaced, or
   * null when it already equalled `actual`. The caller counts what is really in progress; a job
   * that counts while starts are happening must expect to be a little behind and re-run.
   */
  async setCountByJob(owner: CountedOwner, key: string, actual: number): Promise<number | null> {
    if (!Number.isInteger(actual) || actual < 0) {
      throw new Error('A count is a whole number, zero or more (AR-15)');
    }
    const normalised: Owner = { ownerType: owner.ownerType, ownerId: String(owner.ownerId) };
    const counter = this.identity(normalised, key);
    await this.createIfMissing(counter);
    const before = await this.counters
      .findOneAndUpdate(
        { ...counter, value: serverOperators({ $ne: actual }) },
        { $set: { value: actual } },
        { returnDocument: 'before' },
      )
      .lean()
      .exec();
    return before === null ? null : before.value;
  }

  /** The acting owner of this request (BR-002-11), refused when it may not be written (BR-002-30). */
  private writableActingOwner(ctx: AccessContext, actingOwner?: ActingOwner): Owner {
    const acting = actingOwner ?? ctx.resolveActingOwner();
    if (acting.context !== ctx) {
      throw new Error('The acting owner was resolved for another request (BR-002-11)');
    }
    if (!ctx.canWriteOwner(acting.owner)) throw new DomainError('OFFICE_READ_ONLY');
    return acting.owner;
  }

  /** The zero counter, outside any transaction; the loser of a creation race finds the winner's. */
  private async createIfMissing(counter: ReturnType<OwnerCounterRepository['identity']>) {
    try {
      await this.counters
        .updateOne(counter, { $setOnInsert: { value: 0 } }, { upsert: true })
        .exec();
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }

  private identity(owner: Owner, key: string) {
    return { ownerType: owner.ownerType, ownerId: owner.ownerId, key };
  }
}
