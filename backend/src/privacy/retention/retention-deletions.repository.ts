// SPEC-010 BR-010-21 / AR-08 / AR-30: the only file that touches the `retentionDeletions` model. It
// inserts; it has no update and no delete (insert-only, held by
// test/structural/privacy-insert-only.spec.ts). The row holds ids, a count and a date, never a
// document's content or name.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import {
  type RetentionDeletionDocument,
  RetentionDeletionEntity,
} from '../schemas/retention-deletion.schema.js';

/** 11000: MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

export interface NewRetentionDeletion {
  readonly journeyId: string;
  readonly journeyOwnerType: string;
  readonly journeyOwnerId: string;
  readonly fileCount: number;
  readonly deletedAt: Date;
}

@Injectable()
export class RetentionDeletionsRepository {
  constructor(
    @InjectModel(RetentionDeletionEntity.name)
    private readonly model: Model<RetentionDeletionDocument>,
  ) {}

  /**
   * Inserts the log row; false when the journey already has one (the unique index decides, so a
   * repeat and two workers at once end with one row, and the caller treats it as done).
   */
  async insert(entry: NewRetentionDeletion): Promise<boolean> {
    try {
      await this.model.create({
        ...entry,
        journeyId: new Types.ObjectId(entry.journeyId),
        journeyOwnerId: new Types.ObjectId(entry.journeyOwnerId),
      });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) return false;
      throw error;
    }
  }
}
