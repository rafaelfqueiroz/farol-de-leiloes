// SPEC-002 BR-002-13 / AR-15: the atomic plan-limit primitive. A limit check and the count it
// guards are ONE conditional update (`value < limit` → `value + 1`), so concurrent requests can
// never push an owner past its limit. SPEC-016 runs `tryAcquire` in the same transaction as the
// journey insert (pass its session); `release` gives a slot back when the counted thing ends.
//
// Owned (AR-11, AR-12): the owner is the request's acting owner (AccessContext.resolveActingOwner),
// never an id from the request (BR-002-11), and it must be writable now (BR-002-30).
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
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
   * Takes one slot of `key` for the acting owner when fewer than `limit` are taken, atomically
   * (BR-002-13). Answers whether it did; at the limit nothing changes.
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
    const acting = options.actingOwner ?? ctx.resolveActingOwner();
    if (acting.context !== ctx) {
      throw new Error('The acting owner was resolved for another request (BR-002-11)');
    }
    // BR-002-30: a read-only owner takes no new slot.
    if (!ctx.canWriteOwner(acting.owner)) throw new DomainError('OFFICE_READ_ONLY');
    if (limit === 0) return false;

    const counter = this.identity(acting.owner, key);
    // The counter exists before the conditional increment. Done outside the caller's transaction:
    // a zero counter is harmless on its own, and a duplicate-key race (two first acquires at once)
    // must not abort that transaction. The loser of the race finds the winner's counter.
    try {
      await this.counters
        .updateOne(counter, { $setOnInsert: { value: 0 } }, { upsert: true })
        .exec();
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
    // AR-15: check and count in one conditional update. SC-10: the bound is the server's.
    const acquired = await this.counters
      .findOneAndUpdate(
        { ...counter, value: serverOperators({ $lt: limit }) },
        { $inc: { value: 1 } },
        { returnDocument: 'after', session: options.session },
      )
      .lean()
      .exec();
    return acquired !== null;
  }

  /**
   * Gives back one slot of `key` for `owner` (e.g. the owner of the journey that just closed),
   * never below zero. The owner must be one the request may write to (BR-002-30).
   */
  async release(
    ctx: AccessContext,
    owner: Owner,
    key: string,
    options: CounterOptions = {},
  ): Promise<boolean> {
    if (!ctx.canWriteOwner(owner)) {
      throw new Error('A slot is released only for an owner the request may write to (AR-12)');
    }
    const result = await this.counters
      .updateOne(
        { ...this.identity(owner, key), value: serverOperators({ $gt: 0 }) },
        { $inc: { value: -1 } },
        { session: options.session },
      )
      .exec();
    return result.modifiedCount > 0;
  }

  private identity(owner: Owner, key: string) {
    return { ownerType: owner.ownerType, ownerId: owner.ownerId, key };
  }
}
