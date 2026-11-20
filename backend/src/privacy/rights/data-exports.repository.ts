// SPEC-010 BR-010-08, BR-010-11 / AR-08: the only file that touches the `dataExports` model. Every
// request path takes the account's id from the authenticated session (BR-002-11); the worker and the
// closure use the methods named for them. Every transition is ONE conditional update on the state it
// expects, so a race (a closure against the worker, two workers, two requests) ends in one valid state.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import { isObjectIdString } from '../../access/owner-filter.js';
import { serverOperators } from '../../common/mongo/query-safety.js';
import { type PageRequest, skipOf } from '../../common/pagination/paginated.js';
import type { ExportErrorCode, ExportStatus } from '../domain/data-export.js';
import { DataExportEntity } from '../schemas/data-export.schema.js';

/** 11000: MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/** An export as the services read it (a plain value, AR-09). */
export interface DataExportRecord {
  readonly id: string;
  readonly userId: string;
  readonly status: ExportStatus;
  readonly requestedAt: Date;
  readonly fileKey?: string;
  readonly readyAt?: Date;
  readonly expiresAt?: Date;
  readonly errorCode?: ExportErrorCode;
  /** While a worker is building it (or was, and its lease has not run out): the lease's end. */
  readonly claimUntil?: Date;
}

interface StoredExport {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: ExportStatus;
  requestedAt: Date;
  fileKey?: string;
  readyAt?: Date;
  expiresAt?: Date;
  errorCode?: ExportErrorCode;
  claimUntil?: Date;
}

function toRecord(row: StoredExport): DataExportRecord {
  return {
    id: row._id.toHexString(),
    userId: row.userId.toHexString(),
    status: row.status,
    requestedAt: row.requestedAt,
    ...(row.fileKey === undefined ? {} : { fileKey: row.fileKey }),
    ...(row.readyAt === undefined ? {} : { readyAt: row.readyAt }),
    ...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt }),
    ...(row.errorCode === undefined ? {} : { errorCode: row.errorCode }),
    ...(row.claimUntil === undefined ? {} : { claimUntil: row.claimUntil }),
  };
}

/** The statuses that are live, and the ones that are over (a file key left on them is stale). */
const LIVE: ExportStatus[] = ['queued', 'ready'];
const DEAD: ExportStatus[] = ['failed', 'cancelled', 'expired'];

/** The claim fields a terminal transition removes together with the live flag. */
const CLEAR_LIVE_AND_CLAIM = { live: '', claimToken: '', claimUntil: '' } as const;

@Injectable()
export class DataExportsRepository {
  constructor(
    @InjectModel(DataExportEntity.name) private readonly model: Model<DataExportEntity>,
  ) {}

  /**
   * Inserts a queued, live export for the account. Null when the account already has a live one:
   * the partial unique index decides, so twenty requests at once end with one row (BR-010-11).
   */
  async insertQueued(userId: string, requestedAt: Date): Promise<DataExportRecord | null> {
    try {
      const created = await this.model.create({
        userId: new Types.ObjectId(userId),
        requestedAt,
        status: 'queued',
        live: true,
      });
      return toRecord(created.toObject() as unknown as StoredExport);
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) return null;
      throw error;
    }
  }

  /** The account's live (queued or ready) export, if any. */
  async findLiveOf(userId: string): Promise<DataExportRecord | null> {
    const row = await this.model
      .findOne({ userId: { $eq: new Types.ObjectId(userId) }, live: { $eq: true } })
      .lean()
      .exec();
    return row ? toRecord(row as unknown as StoredExport) : null;
  }

  /**
   * One of the ACCOUNT'S exports by id, or null: another account's, a missing and a malformed id are
   * the same null (AR-14, BR-002-12).
   */
  async findOwned(userId: string, id: string): Promise<DataExportRecord | null> {
    if (!isObjectIdString(id)) return null;
    const row = await this.model
      .findOne({ _id: { $eq: id }, userId: { $eq: new Types.ObjectId(userId) } })
      .lean()
      .exec();
    return row ? toRecord(row as unknown as StoredExport) : null;
  }

  /** AR-35: one page of the account's exports, newest first, and how many it has. */
  async pageOf(
    userId: string,
    page: PageRequest,
  ): Promise<{ items: DataExportRecord[]; total: number }> {
    const owner = { userId: { $eq: new Types.ObjectId(userId) } };
    const [rows, total] = await Promise.all([
      this.model
        .find(owner)
        .sort({ requestedAt: -1, _id: -1 })
        .skip(skipOf(page))
        .limit(page.pageSize)
        .lean()
        .exec(),
      this.model.countDocuments(owner).exec(),
    ]);
    return { items: rows.map((row) => toRecord(row as unknown as StoredExport)), total };
  }

  /** Whether any export waits for the worker (a cheap peek before the worker takes its lock). */
  async hasQueued(): Promise<boolean> {
    return (await this.model.exists({ status: { $eq: 'queued' } })) !== null;
  }

  /**
   * Claims the oldest queued export that no worker holds (a lease: a crashed worker's claim
   * expires), choosing its file key in the same update (the key is written BEFORE any file, so no
   * file is ever unnamed, see the schema). Null when there is nothing to claim.
   */
  async claimNextQueued(
    token: string,
    fileKey: string,
    now: Date,
    until: Date,
  ): Promise<DataExportRecord | null> {
    const row = await this.model
      .findOneAndUpdate(
        {
          status: { $eq: 'queued' },
          $or: [
            { claimUntil: serverOperators({ $exists: false }) },
            { claimUntil: serverOperators({ $lte: now }) },
          ],
        },
        // `fileKey` only if there is none yet: a re-claim after a crash reuses the first key, so one
        // export never names two files.
        [
          {
            $set: {
              claimToken: { $literal: token },
              claimUntil: { $literal: until },
              fileKey: { $ifNull: ['$fileKey', { $literal: fileKey }] },
            },
          },
        ],
        { sort: { requestedAt: 1, _id: 1 }, returnDocument: 'after', updatePipeline: true },
      )
      .lean()
      .exec();
    return row ? toRecord(row as unknown as StoredExport) : null;
  }

  /**
   * queued -> ready, only for the worker that still holds the claim and only while the export is
   * still queued (a closure that cancelled it meanwhile makes this match nothing: the caller then
   * deletes the file it wrote). True when it became ready.
   */
  async markReady(id: string, token: string, readyAt: Date, expiresAt: Date): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: { $eq: id }, status: { $eq: 'queued' }, claimToken: { $eq: token } },
        {
          $set: { status: 'ready', readyAt, expiresAt },
          // Still live (ready); the claim has done its work.
          $unset: { claimToken: '', claimUntil: '' },
        },
      )
      .exec();
    return result.matchedCount > 0;
  }

  /**
   * queued -> failed with a stable code, for the worker that holds the claim. The file key is NEVER
   * removed here: it was chosen before any write and a file may exist under it (an upload that failed
   * half way, or one a crashed earlier worker left), so the cleanup deletes the file and only then
   * clears the key. True when it did.
   */
  async markFailed(id: string, token: string, errorCode: ExportErrorCode): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: { $eq: id }, status: { $eq: 'queued' }, claimToken: { $eq: token } },
        { $set: { status: 'failed', errorCode }, $unset: CLEAR_LIVE_AND_CLAIM },
      )
      .exec();
    return result.matchedCount > 0;
  }

  /**
   * SPEC-010 BR-010-14: the account was closed: every live export (queued, or ready and not yet
   * downloaded) becomes `cancelled` in one update, which makes the worker's `markReady` match
   * nothing whichever of the two ran first. The file key stays on the row so the file is deleted by
   * whoever finds it (`findWithStaleFile`). Answers how many it cancelled; idempotent.
   */
  async cancelLiveOf(userId: string): Promise<number> {
    const result = await this.model
      .updateMany(
        {
          userId: { $eq: new Types.ObjectId(userId) },
          status: serverOperators({ $in: LIVE }),
        },
        // The claim stays: a worker that is still building keeps its lease visible, so the purge waits
        // for it instead of deleting the row under it (see DataExportsPersonalData).
        { $set: { status: 'cancelled' }, $unset: { live: '' } },
      )
      .exec();
    return result.modifiedCount;
  }

  /** Ready exports whose time ran out, oldest expiry first (the expiry job). */
  async findDueForExpiry(now: Date, limit: number): Promise<DataExportRecord[]> {
    const rows = await this.model
      .find({ status: { $eq: 'ready' }, expiresAt: serverOperators({ $lte: now }) })
      .sort({ expiresAt: 1, _id: 1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map((row) => toRecord(row as unknown as StoredExport));
  }

  /** ready -> expired, once its file is gone: the key is removed with the status. True when it did. */
  async markExpired(id: string): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: { $eq: id }, status: { $eq: 'ready' } },
        { $set: { status: 'expired' }, $unset: { fileKey: '', ...CLEAR_LIVE_AND_CLAIM } },
      )
      .exec();
    return result.matchedCount > 0;
  }

  /**
   * Rows that are no longer live but still name a file (failed, cancelled, expired) and that no
   * worker is building right now (no live claim lease at `now`): the file is deleted and the key
   * removed (`clearFileKey`). This is also what repairs a worker that crashed or lost a race after
   * writing the file.
   */
  async findWithStaleFile(now: Date, limit: number): Promise<DataExportRecord[]> {
    const rows = await this.model
      .find({
        status: serverOperators({ $in: DEAD }),
        fileKey: serverOperators({ $exists: true }),
        $or: [
          { claimUntil: serverOperators({ $exists: false }) },
          { claimUntil: serverOperators({ $lte: now }) },
        ],
      })
      .sort({ updatedAt: 1, _id: 1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map((row) => toRecord(row as unknown as StoredExport));
  }

  /** The export by id, whoever owns it (internal: the worker's check of its own row), or null. */
  async findById(id: string): Promise<DataExportRecord | null> {
    if (!isObjectIdString(id)) return null;
    const row = await this.model
      .findOne({ _id: { $eq: id } })
      .lean()
      .exec();
    return row ? toRecord(row as unknown as StoredExport) : null;
  }

  /**
   * SPEC-010 BR-010-11: a ready export whose time ran out is ended where it is found (a request for a
   * new one): ready -> expired in one conditional update, the live flag removed so a new export can
   * be queued. The file key stays, so the cleanup deletes the file. True when it did.
   */
  async expireNow(id: string): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: { $eq: id }, status: { $eq: 'ready' } },
        { $set: { status: 'expired' }, $unset: { live: '' } },
      )
      .exec();
    return result.matchedCount > 0;
  }

  /**
   * Removes the file key of a row that is not live any more, once its file is deleted, and the claim
   * with it (nobody is building into that file any more).
   */
  async clearFileKey(id: string): Promise<void> {
    await this.model
      .updateOne(
        {
          _id: { $eq: id },
          status: serverOperators({ $in: DEAD }),
        },
        { $unset: { fileKey: '', claimToken: '', claimUntil: '' } },
      )
      .exec();
  }

  /** Every export of the account, newest first, for the "my data" view and the export itself. */
  async allOf(userId: string): Promise<DataExportRecord[]> {
    const rows = await this.model
      .find({ userId: { $eq: new Types.ObjectId(userId) } })
      .sort({ requestedAt: -1, _id: -1 })
      .lean()
      .exec();
    return rows.map((row) => toRecord(row as unknown as StoredExport));
  }

  /** SPEC-010 BR-010-15: deletes one row, after its file is gone (the purge). */
  async deleteOne(id: string): Promise<void> {
    await this.model.deleteOne({ _id: { $eq: id } }).exec();
  }
}
