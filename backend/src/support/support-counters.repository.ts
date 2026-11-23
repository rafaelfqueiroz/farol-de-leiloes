// SPEC-009 BR-009-06 / AR-08: the only file that touches the `counters` model. One atomic `$inc` hands
// out the next number of a key, so concurrent requests never share one.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { SupportCounterEntity } from './schemas/support-counter.schema.js';

/** 11000: MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/** The server retries a first-creation race itself; this is only the belt to that braces. */
const ATTEMPTS = 3;

@Injectable()
export class SupportCountersRepository {
  constructor(
    @InjectModel(SupportCounterEntity.name) private readonly model: Model<SupportCounterEntity>,
  ) {}

  /**
   * The next number of the counter `key` (1 the first time): `findOneAndUpdate` with `$inc` and
   * `upsert`, answering the document AFTER the increment, so the number is this caller's alone.
   */
  async next(key: string): Promise<number> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const counter = await this.model
          .findOneAndUpdate(
            { _id: { $eq: key } },
            { $inc: { seq: 1 } },
            { upsert: true, returnDocument: 'after' },
          )
          .lean()
          .exec();
        if (!counter) throw new Error('MongoDB answered no counter');
        return counter.seq;
      } catch (error) {
        // Two first-ever upserts of one key can collide on _id; the loser simply increments.
        if ((error as { code?: number }).code !== DUPLICATE_KEY || attempt >= ATTEMPTS) throw error;
      }
    }
  }
}
