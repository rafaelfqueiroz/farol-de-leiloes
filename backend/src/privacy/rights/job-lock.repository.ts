// SPEC-010 (AR-03) / AR-08: the only file that touches the `jobLocks` model.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { serverOperators } from '../../common/mongo/query-safety.js';
import { JobLockEntity } from '../schemas/job-lock.schema.js';

/** 11000: MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

@Injectable()
export class JobLockRepository {
  constructor(@InjectModel(JobLockEntity.name) private readonly model: Model<JobLockEntity>) {}

  /**
   * Takes the lock `name` for `token` until `until`, in one conditional update: it matches only when
   * nobody holds it or the holder's time ran out, and creates the document the first time. When it is
   * held the upsert tries to insert a second document with the same `_id` and the duplicate-key error
   * is the answer "not acquired". True when this caller holds the lock.
   */
  async tryAcquire(name: string, token: string, now: Date, until: Date): Promise<boolean> {
    try {
      await this.model
        .findOneAndUpdate(
          {
            _id: { $eq: name },
            $or: [
              { heldUntil: serverOperators({ $exists: false }) },
              { heldUntil: serverOperators({ $lte: now }) },
            ],
          },
          { $set: { token, heldUntil: until } },
          { upsert: true, returnDocument: 'after' },
        )
        .exec();
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) return false;
      throw error;
    }
  }

  /** Gives the lock back, only if `token` still holds it. */
  async release(name: string, token: string): Promise<void> {
    await this.model
      .updateOne(
        { _id: { $eq: name }, token: { $eq: token } },
        { $unset: { token: '', heldUntil: '' } },
      )
      .exec();
  }
}
