import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { serverOperators } from '../../common/mongo/query-safety.js';
import { type PageRequest, skipOf } from '../../common/pagination/paginated.js';
import {
  type ImportCounts,
  type ImportOutcome,
  type ImportRunRecord,
  type NonBusinessReason,
  NO_COUNTS,
  NO_PROGRESS,
} from './import-run.js';
import { ImportRunEntity, ImportRunDocument } from './import-run.schema.js';

type RunRow = ImportRunEntity & { _id: Types.ObjectId };

/** The outcomes that end a day without a list (the ones an alert may be about, BR-004-29). */
export const ALERTABLE_OUTCOMES = ['FAILED', 'REJECTED_LIST', 'NO_NEW_LIST'] as const;

/**
 * The only file that touches the `importruns` model (AR-08).
 *
 * Every write the worker of a run makes is fenced on the lease (`leaseOwner`): when the lease was
 * lost (the worker stalled past its expiry and another took the run over) the write matches nothing
 * and the worker stops. The writes of the signal (`completeUpdate`) and of the alert
 * (`claimAlert`) are conditional on their own "not yet" state instead, so they happen exactly once
 * whichever process gets there.
 */
@Injectable()
export class ImportRunRepository {
  constructor(
    @InjectModel(ImportRunEntity.name) private readonly model: Model<ImportRunDocument>,
  ) {}

  async findByDate(brasiliaDate: string): Promise<ImportRunRecord | null> {
    const row = await this.model
      .findOne({ brasiliaDate: { $eq: brasiliaDate } })
      .lean()
      .exec();
    return row ? toRecord(row as RunRow) : null;
  }

  async findById(id: string): Promise<ImportRunRecord | null> {
    const row = await this.model
      .findOne({ _id: { $eq: new Types.ObjectId(id) } })
      .lean()
      .exec();
    return row ? toRecord(row as RunRow) : null;
  }

  /** The newest run that ended SUCCESS: the list the validator compares a new one with. */
  async findLastSuccess(): Promise<ImportRunRecord | null> {
    const row = await this.model
      .findOne({ outcome: 'SUCCESS' })
      .sort({ brasiliaDate: -1 })
      .lean()
      .exec();
    return row ? toRecord(row as RunRow) : null;
  }

  /**
   * BR-004-24: the newest run whose daily update was completed (applied, collected, signalled).
   * A failed, rejected, not-new or no-update run is never one, so "last updated" does not move.
   */
  async findLastCompleted(): Promise<ImportRunRecord | null> {
    const row = await this.model
      .findOne({ outcome: 'SUCCESS', updateCompletedAt: serverOperators({ $ne: null }) })
      .sort({ brasiliaDate: -1 })
      .lean()
      .exec();
    return row ? toRecord(row as RunRow) : null;
  }

  /**
   * The runs the tick has work for: undecided ones (RUNNING), oldest first, and applied ones whose
   * update is not complete yet (a crash between the apply and the collection). A run of an earlier
   * day is here too: it keeps its date across midnight.
   */
  async findOpen(): Promise<ImportRunRecord[]> {
    const rows = await this.model
      .find({
        $or: [{ outcome: 'RUNNING' }, { outcome: 'SUCCESS', updateCompletedAt: null }],
      })
      .sort({ brasiliaDate: 1 })
      .limit(10)
      .lean()
      .exec();
    return rows.map((row) => toRecord(row as RunRow));
  }

  /**
   * Runs that may still owe the admins an email (BR-004-29): not alerted yet and either decided
   * as a failure, or applied with the collection blocked, and not older than `sinceDate`: an
   * alert is about recent days, and a row an earlier part of the import left must never email on
   * the first deploy.
   */
  async findAlertCandidates(sinceDate: string): Promise<ImportRunRecord[]> {
    const rows = await this.model
      .find({
        brasiliaDate: serverOperators({ $gte: sinceDate }),
        alertedAt: null,
        $or: [
          { outcome: serverOperators({ $in: [...ALERTABLE_OUTCOMES] }) },
          { outcome: 'SUCCESS', 'detailCollection.blocked': true },
        ],
      })
      .sort({ brasiliaDate: -1 })
      .limit(10)
      .lean()
      .exec();
    return rows.map((row) => toRecord(row as RunRow));
  }

  /** BR-004-28: a page of runs, newest first. */
  async findPage(request: PageRequest): Promise<{ items: ImportRunRecord[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.model
        .find({})
        .sort({ brasiliaDate: -1 })
        .skip(skipOf(request))
        .limit(request.pageSize)
        .lean()
        .exec(),
      this.model.countDocuments({}).exec(),
    ]);
    return { items: rows.map((row) => toRecord(row as RunRow)), total };
  }

  /**
   * The day's run, created if the day has none (BR-004-27: one per Brasília date). The unique
   * `brasiliaDate` settles two processes creating it at once: the loser reads the winner's row.
   */
  async ensure(brasiliaDate: string, now: Date): Promise<ImportRunRecord> {
    const filter = { brasiliaDate: { $eq: brasiliaDate } };
    const update = {
      $setOnInsert: { brasiliaDate, startedAt: now, outcome: 'RUNNING' as ImportOutcome },
    };
    try {
      const row = await this.model
        .findOneAndUpdate(filter, update, {
          upsert: true,
          returnDocument: 'after',
          timestamps: true,
        })
        .lean()
        .exec();
      return toRecord(row as RunRow);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const existing = await this.model.findOne(filter).lean().exec();
      if (existing === null) throw error;
      return toRecord(existing as RunRow);
    }
  }

  /**
   * Takes the run's lease for `owner` until `expiresAt`, in ONE conditional update: it succeeds
   * only when nobody holds the run or the holder's lease has expired (a killed process leaves
   * one). Returns the run as it is now, or null when somebody else works it.
   */
  async acquireLease(
    id: string,
    owner: string,
    now: Date,
    expiresAt: Date,
  ): Promise<ImportRunRecord | null> {
    const row = await this.model
      .findOneAndUpdate(
        {
          _id: { $eq: new Types.ObjectId(id) },
          $or: [{ leaseOwner: null }, { leaseExpiresAt: serverOperators({ $lte: now }) }],
        },
        { $set: { leaseOwner: owner, leaseExpiresAt: expiresAt } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    return row ? toRecord(row as RunRow) : null;
  }

  /** Extends the lease while the holder is still working. False when it is no longer the holder's. */
  async renewLease(id: string, owner: string, expiresAt: Date): Promise<boolean> {
    const result = await this.model
      .updateOne(this.held(id, owner), { $set: { leaseExpiresAt: expiresAt } })
      .exec();
    // Matched, not modified: renewing at the same instant changes nothing and the holder still holds.
    return result.matchedCount === 1;
  }

  async releaseLease(id: string, owner: string): Promise<void> {
    await this.model
      .updateOne(this.held(id, owner), { $set: { leaseOwner: null, leaseExpiresAt: null } })
      .exec();
  }

  /** One attempt more, begun at `now`; the next one is due at `nextAttemptAt` (BR-004-02). */
  async beginAttempt(id: string, owner: string, nextAttemptAt: Date): Promise<boolean> {
    return this.write(id, owner, { $inc: { attempts: 1 }, $set: { nextAttemptAt } });
  }

  /** Caixa answered with a list (a new one or not): it was reachable (BR-004-03). */
  async markListReached(id: string, owner: string): Promise<boolean> {
    return this.write(id, owner, { $set: { 'progress.listReached': true } });
  }

  /**
   * A resume gives the half-applied state up: the process that was applying the list is gone and
   * the list is judged afresh. Until a valid list is applied the day carries `applyFailed`: a list
   * that passed validation was never applied, which is what the day ends as if nothing else
   * works out (`beginApply` clears it again).
   */
  async clearApplying(id: string, owner: string): Promise<boolean> {
    return this.write(id, owner, {
      $set: { 'progress.applying': false, 'progress.applyFailed': true },
      $addToSet: { failureReasons: 'APPLY_INTERRUPTED' },
    });
  }

  /** The validator refused a list (BR-004-04): its day and code, never a row (SC-15). */
  async recordRejection(
    id: string,
    owner: string,
    rejection: { generatedOn: string | null; reason: string; rows: number },
  ): Promise<boolean> {
    return this.write(id, owner, {
      $set: {
        'progress.listReached': true,
        'progress.rejection': { generatedOn: rejection.generatedOn, reason: rejection.reason },
        listGeneratedAt: rejection.generatedOn,
        listRows: rejection.rows,
      },
      $addToSet: { failureReasons: rejection.reason },
    });
  }

  /** A failure of an attempt that left no list to apply, by its stable code (SC-15). */
  async recordFailureCode(id: string, owner: string, code: string): Promise<boolean> {
    return this.write(id, owner, { $addToSet: { failureReasons: code } });
  }

  /**
   * A validated list is about to be applied: from here until the apply ended, a dead process is
   * resumed by the next tick (BR-004-07). A newer valid list replaces an earlier refusal.
   */
  async beginApply(
    id: string,
    owner: string,
    list: { generatedOn: string; rows: number },
  ): Promise<boolean> {
    return this.write(id, owner, {
      $set: {
        'progress.listReached': true,
        'progress.applying': true,
        'progress.applyFailed': false,
        listGeneratedAt: list.generatedOn,
        listRows: list.rows,
      },
    });
  }

  /** The apply threw: the list stays unapplied, the code says why (the class, SC-15). */
  async markApplyFailed(id: string, owner: string, code: string): Promise<boolean> {
    return this.write(id, owner, {
      $set: { 'progress.applying': false, 'progress.applyFailed': true },
      $addToSet: { failureReasons: code },
    });
  }

  /** RUNNING -> SUCCESS with the counts: the list is applied (BR-004-06..08). */
  async markSuccess(id: string, owner: string, counts: ImportCounts, now: Date): Promise<boolean> {
    return this.write(
      id,
      owner,
      {
        $set: {
          outcome: 'SUCCESS',
          finishedAt: now,
          counts,
          nextAttemptAt: null,
          'progress.applying': false,
          'progress.applyFailed': false,
        },
      },
      { outcome: 'RUNNING' },
    );
  }

  /**
   * RUNNING -> a decided outcome (BR-004-03): FAILED, REJECTED_LIST, NO_NEW_LIST or NO_UPDATE. A
   * decided run changes no property data and moves no "last updated" (BR-004-10).
   */
  async finalize(
    id: string,
    owner: string,
    decision: {
      outcome: Exclude<ImportOutcome, 'RUNNING' | 'SUCCESS'>;
      reason: string;
      nonBusinessReason: NonBusinessReason | null;
    },
    now: Date,
  ): Promise<boolean> {
    return this.write(
      id,
      owner,
      {
        $set: {
          outcome: decision.outcome,
          finishedAt: now,
          nextAttemptAt: null,
          'progress.applying': false,
          ...(decision.nonBusinessReason === null
            ? {}
            : { nonBusinessReason: decision.nonBusinessReason }),
        },
        $addToSet: { failureReasons: decision.reason },
      },
      { outcome: 'RUNNING' },
    );
  }

  /**
   * Caixa blocked the list request (BR-004-20, SC-24): the block and the end of the day are ONE
   * update (AR-03). RUNNING -> FAILED `LIST_BLOCKED`, with the block's reason code both on the
   * progress (what recovery reads) and among the failure reasons. Written as two updates, a
   * process that stopped between them (or a second one failing) left a RUNNING run whose next
   * spaced tick asked Caixa again the same day.
   */
  async finalizeBlocked(
    id: string,
    owner: string,
    block: { reason: string; code: string },
    now: Date,
  ): Promise<boolean> {
    return this.write(
      id,
      owner,
      {
        $set: {
          outcome: 'FAILED',
          finishedAt: now,
          nextAttemptAt: null,
          'progress.applying': false,
          'progress.blocked': block.reason,
        },
        $addToSet: { failureReasons: { $each: [block.reason, block.code] } },
      },
      { outcome: 'RUNNING' },
    );
  }

  /** The result of the day's collection pass (BR-004-23, BR-004-27). */
  async saveCollection(
    id: string,
    owner: string,
    collection: { collected: number; failed: number; blocked: boolean },
  ): Promise<boolean> {
    return this.write(id, owner, { $set: { detailCollection: collection } });
  }

  /**
   * "Daily update complete" (BR-004-23): `updateCompletedAt` null -> now, in ONE conditional
   * update, only for an applied run. True for exactly one caller however many tick at once.
   */
  async completeUpdate(id: string, now: Date): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: { $eq: new Types.ObjectId(id) }, outcome: 'SUCCESS', updateCompletedAt: null },
        { $set: { updateCompletedAt: now } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** BR-004-29: claims the one alert of the run (`alertedAt` null -> now). True for one caller. */
  async claimAlert(id: string, now: Date): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: { $eq: new Types.ObjectId(id) }, alertedAt: null },
        { $set: { alertedAt: now } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** Gives the claim back (nobody could be told), so the next tick tries again. */
  async releaseAlert(id: string): Promise<void> {
    await this.model
      .updateOne({ _id: { $eq: new Types.ObjectId(id) } }, { $set: { alertedAt: null } })
      .exec();
  }

  /** The filter of a write only the lease holder may make (and, optionally, in a given state). */
  private held(id: string, owner: string, extra: object = {}) {
    return {
      _id: { $eq: new Types.ObjectId(id) },
      leaseOwner: { $eq: owner },
      ...extra,
    };
  }

  private async write(
    id: string,
    owner: string,
    update: Record<string, unknown>,
    inState: { outcome: ImportOutcome } | Record<string, never> = {},
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(this.held(id, owner, inState), update, { timestamps: true })
      .exec();
    // Matched: the fence held (the lease is the worker's and the run is in the state asked for).
    return result.matchedCount === 1;
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000
  );
}

function toRecord(row: RunRow): ImportRunRecord {
  return {
    id: row._id.toString(),
    brasiliaDate: row.brasiliaDate,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    outcome: row.outcome,
    listGeneratedAt: row.listGeneratedAt ?? null,
    listRows: row.listRows ?? 0,
    attempts: row.attempts ?? 0,
    counts: { ...NO_COUNTS, ...(row.counts ?? {}) },
    collection: row.detailCollection ?? { collected: 0, failed: 0, blocked: false },
    failureReasons: [...(row.failureReasons ?? [])],
    alertedAt: row.alertedAt ?? null,
    updateCompletedAt: row.updateCompletedAt ?? null,
    nextAttemptAt: row.nextAttemptAt ?? null,
    progress: {
      ...NO_PROGRESS,
      ...(row.progress ?? {}),
      rejection: row.progress?.rejection ?? null,
      blocked: row.progress?.blocked ?? null,
    },
    nonBusinessReason: row.nonBusinessReason ?? null,
    leaseOwner: row.leaseOwner ?? null,
    leaseExpiresAt: row.leaseExpiresAt ?? null,
  };
}
