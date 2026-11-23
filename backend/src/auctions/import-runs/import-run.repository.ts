import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { serverOperators } from '../../common/mongo/query-safety.js';
import {
  type ImportCounts,
  type ImportOutcome,
  type ImportRunRecord,
  NO_COUNTS,
} from './import-run.js';
import { ImportRunEntity, ImportRunDocument } from './import-run.schema.js';

type RunRow = ImportRunEntity & { _id: Types.ObjectId };

/** The only file that touches the `importruns` model (AR-08). */
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
   * Starts (or restarts) the day's run as RUNNING for a validated list, one attempt more. A run
   * that already ended SUCCESS is not touched: null. A run still RUNNING is entered again, on
   * purpose: its process may have died, and applying the same list twice, even at once, converges
   * (BR-004-07). The unique `brasiliaDate` settles two attempts racing to create it.
   */
  async begin(
    brasiliaDate: string,
    list: { generatedOn: string; rows: number },
    now: Date,
  ): Promise<ImportRunRecord | null> {
    return this.claim(brasiliaDate, 'RUNNING', ['SUCCESS'], now, {
      listGeneratedAt: list.generatedOn,
      listRows: list.rows,
    });
  }

  /**
   * Records a day whose list was not applied (REJECTED_LIST, NO_NEW_LIST, or FAILED before any
   * apply): the outcome and its reason code, one attempt more. A day already SUCCESS or RUNNING
   * is left as it is: a later attempt never undoes a success (BR-004-10), nor reports a run
   * being applied as rejected.
   */
  async recordWithoutApply(
    brasiliaDate: string,
    outcome: Exclude<ImportOutcome, 'RUNNING' | 'SUCCESS'>,
    reason: string,
    list: { generatedOn: string | null; rows: number },
    now: Date,
  ): Promise<ImportRunRecord | null> {
    return this.claim(brasiliaDate, outcome, ['SUCCESS', 'RUNNING'], now, {
      ...(list.generatedOn === null ? {} : { listGeneratedAt: list.generatedOn }),
      listRows: list.rows,
      finishedAt: now,
      reason,
    });
  }

  private async claim(
    brasiliaDate: string,
    outcome: ImportOutcome,
    refused: readonly ImportOutcome[],
    now: Date,
    extra: {
      listGeneratedAt?: string;
      listRows: number;
      finishedAt?: Date;
      reason?: string;
    },
  ): Promise<ImportRunRecord | null> {
    const { reason, ...set } = extra;
    try {
      const row = await this.model
        .findOneAndUpdate(
          {
            brasiliaDate: { $eq: brasiliaDate },
            // Only a day whose run is not in a state this attempt must leave alone.
            outcome: serverOperators({ $nin: [...refused] }),
          },
          {
            $set: { outcome, finishedAt: null, ...set },
            ...(reason === undefined ? {} : { $addToSet: { failureReasons: reason } }),
            $inc: { attempts: 1 },
            $setOnInsert: { brasiliaDate, startedAt: now },
          },
          { upsert: true, returnDocument: 'after', timestamps: true },
        )
        .lean()
        .exec();
      return row ? toRecord(row as RunRow) : null;
    } catch (error) {
      // The day's row exists and does not match: it is in a refused state (unique brasiliaDate).
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  }

  /**
   * RUNNING -> SUCCESS with the counts. A run another attempt marked FAILED meanwhile may still
   * become SUCCESS (this attempt applied the whole list; applying is idempotent). False when the
   * run is SUCCESS already (another attempt got there first) or is in no state to end this way.
   */
  async markSuccess(id: string, counts: ImportCounts, now: Date): Promise<boolean> {
    const result = await this.model
      .updateOne(
        {
          _id: new Types.ObjectId(id),
          outcome: serverOperators({ $in: ['RUNNING', 'FAILED'] as ImportOutcome[] }),
        },
        // failureReasons stays: an earlier attempt's reason is the day's history.
        { $set: { outcome: 'SUCCESS', finishedAt: now, counts } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** RUNNING -> FAILED with a stable failure code (SC-15). */
  async markFailed(id: string, code: string, now: Date): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: new Types.ObjectId(id), outcome: 'RUNNING' },
        { $set: { outcome: 'FAILED', finishedAt: now }, $addToSet: { failureReasons: code } },
      )
      .exec();
    return result.modifiedCount === 1;
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
  };
}
