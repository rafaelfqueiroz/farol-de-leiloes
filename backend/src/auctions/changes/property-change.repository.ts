import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { ChangeDraft, ChangeType } from '../domain/change-types.js';
import { PropertyChangeEntity, PropertyChangeDocument } from './property-change.schema.js';

/** A change entry as the services answer with it (AR-09). */
export interface PropertyChangeRecord extends ChangeDraft {
  importRunId: string;
  createdAt: Date;
}

/** The only file that touches the `propertychanges` model (AR-08). */
@Injectable()
export class PropertyChangeRepository {
  constructor(
    @InjectModel(PropertyChangeEntity.name)
    private readonly model: Model<PropertyChangeDocument>,
  ) {}

  /**
   * Writes the entries by upsert on the unique (run, property, field), `$setOnInsert` only: an
   * entry written once is never rewritten, so recording the same list's entries again, after a
   * crash or from two processes, leaves one of each (BR-004-07).
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
          filter: { importRunId: runId, propertyCode: draft.propertyCode, field: draft.field },
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

function toRecord(row: PropertyChangeEntity): PropertyChangeRecord {
  return {
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
