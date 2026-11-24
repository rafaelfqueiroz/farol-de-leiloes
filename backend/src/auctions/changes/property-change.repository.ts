import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { serverOperators } from '../../common/mongo/query-safety.js';
import type { ChangeDraft, ChangeType } from '../domain/change-types.js';
import { PropertyChangeEntity, PropertyChangeDocument } from './property-change.schema.js';

/** A change entry as the services answer with it (AR-09). */
export interface PropertyChangeRecord extends ChangeDraft {
  id: string;
  importRunId: string;
  createdAt: Date;
}

/**
 * Where a consumer stopped reading: the last entry it processed, in (createdAt, id) order. Opaque
 * to the consumer, who stores it and hands it back.
 */
export interface ChangeCursor {
  createdAt: Date;
  id: string;
}

export interface ChangeReadOptions {
  /** Only the entries BR-004-26 calls relevant (the Radar's and the digest's). */
  relevantOnly: boolean;
  limit: number;
}

/** The only file that touches the `propertychanges` model (AR-08). */
@Injectable()
export class PropertyChangeRepository {
  constructor(
    @InjectModel(PropertyChangeEntity.name)
    private readonly model: Model<PropertyChangeDocument>,
  ) {}

  /**
   * Writes the entries by upsert on the unique (run, property, field, type), `$setOnInsert` only: an
   * entry written once is never rewritten, so recording the same list's entries again, after a
   * crash or from two processes of the SAME run, leaves one of each (BR-004-07). The key holds the
   * run, so a retry under another run id is the service's `recordUnlessRepeated` to stop.
   */
  async upsertMany(
    runId: Types.ObjectId,
    drafts: readonly ChangeDraft[],
    now: Date,
  ): Promise<void> {
    if (drafts.length === 0) return;
    await this.model.bulkWrite(
      drafts.map((draft) => ({
        updateOne: {
          filter: {
            importRunId: runId,
            propertyCode: draft.propertyCode,
            field: draft.field,
            type: draft.type,
          },
          update: {
            $setOnInsert: {
              source: draft.source,
              type: draft.type,
              relevant: draft.relevant,
              oldValue: draft.oldValue,
              newValue: draft.newValue,
              createdAt: now,
            },
          },
          upsert: true,
          timestamps: false,
        },
      })),
      { ordered: false },
    );
  }

  /**
   * The newest entries of the given fields of the given properties, newest first, grouped by
   * `code` then `field`, at most `perField` of each (what a replay compares with, `isRepeat`). One
   * read for a whole chunk of rows, by the (propertyCode, createdAt) index.
   */
  async findRecentByFields(
    codes: readonly string[],
    fields: readonly string[],
    perField: number,
  ): Promise<
    Map<string, Map<string, Pick<PropertyChangeRecord, 'type' | 'oldValue' | 'newValue'>[]>>
  > {
    const found = new Map<
      string,
      Map<string, Pick<PropertyChangeRecord, 'type' | 'oldValue' | 'newValue'>[]>
    >();
    if (codes.length === 0 || fields.length === 0) return found;
    const rows = await this.model
      .find({
        propertyCode: serverOperators({ $in: [...codes] }),
        field: serverOperators({ $in: [...fields] }),
      })
      .sort({ createdAt: -1, _id: -1 })
      .select('propertyCode field type oldValue newValue')
      .lean()
      .exec();
    for (const row of rows) {
      const byField = found.get(row.propertyCode) ?? new Map();
      const entries = byField.get(row.field) ?? [];
      if (entries.length < perField) {
        entries.push({ type: row.type, oldValue: row.oldValue, newValue: row.newValue });
      }
      byField.set(row.field, entries);
      found.set(row.propertyCode, byField);
    }
    return found;
  }

  countByRunAndType(runId: Types.ObjectId, type: ChangeType): Promise<number> {
    return this.model.countDocuments({ importRunId: runId, type }).exec();
  }

  async findByRun(runId: Types.ObjectId): Promise<PropertyChangeRecord[]> {
    const rows = await this.model
      .find({ importRunId: runId })
      .sort({ propertyCode: 1, field: 1 })
      .lean()
      .exec();
    return rows.map(toRecord);
  }

  /**
   * The entries written after `cursor` (all of them when null), oldest first, by (createdAt, id):
   * whichever run wrote them, so entries of a run that FAILED and was retried are read once, when
   * they were written, and the retry (which writes none of them again) adds nothing twice.
   */
  async findSince(
    cursor: ChangeCursor | null,
    { relevantOnly, limit }: ChangeReadOptions,
  ): Promise<PropertyChangeRecord[]> {
    const rows = await this.model
      .find({
        ...(relevantOnly ? { relevant: true } : {}),
        ...(cursor === null
          ? {}
          : {
              $or: [
                { createdAt: serverOperators({ $gt: cursor.createdAt }) },
                {
                  createdAt: cursor.createdAt,
                  _id: serverOperators({ $gt: new Types.ObjectId(cursor.id) }),
                },
              ],
            }),
      })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map(toRecord);
  }

  /** The entries created in [from, to), oldest first (the digest of a window). */
  async findCreatedBetween(
    from: Date,
    to: Date,
    relevantOnly: boolean,
  ): Promise<PropertyChangeRecord[]> {
    const rows = await this.model
      .find({
        ...(relevantOnly ? { relevant: true } : {}),
        createdAt: serverOperators({ $gte: from, $lt: to }),
      })
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();
    return rows.map(toRecord);
  }

  async findByCode(code: string, limit: number): Promise<PropertyChangeRecord[]> {
    const rows = await this.model
      .find({ propertyCode: { $eq: code } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map(toRecord);
  }
}

function toRecord(row: PropertyChangeEntity & { _id: Types.ObjectId }): PropertyChangeRecord {
  return {
    id: row._id.toString(),
    propertyCode: row.propertyCode,
    importRunId: row.importRunId.toString(),
    source: row.source,
    type: row.type,
    relevant: row.relevant,
    field: row.field,
    oldValue: row.oldValue,
    newValue: row.newValue,
    createdAt: row.createdAt,
  };
}
