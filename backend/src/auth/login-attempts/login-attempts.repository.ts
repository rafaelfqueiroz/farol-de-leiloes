import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { serverOperators } from '../../common/mongo/query-safety.js';
import { LoginAttemptEntity } from './login-attempt.schema.js';

/** AR-08: the only file that touches the `loginAttempts` model. */
@Injectable()
export class LoginAttemptsRepository {
  constructor(
    @InjectModel(LoginAttemptEntity.name) private readonly model: Model<LoginAttemptEntity>,
  ) {}

  /** Whether any of the keys is refused at `now`. */
  async isBlocked(keys: string[], now: Date): Promise<boolean> {
    const found = await this.model.exists({
      key: serverOperators({ $in: keys }),
      blockedUntil: serverOperators({ $gt: now }),
    });
    return found !== null;
  }

  /**
   * Counts one failure for the key in a single atomic upsert, so concurrent failures cannot lose
   * a count (BR-001-15). A pipeline update does the whole decision server-side: start a new
   * window when none is open, otherwise add one, and once the count reaches `limit` set the ban
   * to `now + banMs` (kept if one is already running).
   */
  async recordFailure(
    key: string,
    now: Date,
    rule: { limit: number; windowMs: number; banMs: number },
  ): Promise<void> {
    const windowCutoff = new Date(now.getTime() - rule.windowMs);
    const banUntil = new Date(now.getTime() + rule.banMs);
    const epoch = new Date(0);
    await this.model
      .updateOne(
        { key: { $eq: key } },
        [
          {
            $set: {
              // One $set stage reads the stored values for every field it writes.
              count: {
                $cond: [
                  { $lte: [{ $ifNull: ['$windowStart', epoch] }, windowCutoff] },
                  1,
                  { $add: ['$count', 1] },
                ],
              },
              windowStart: {
                $cond: [
                  { $lte: [{ $ifNull: ['$windowStart', epoch] }, windowCutoff] },
                  now,
                  '$windowStart',
                ],
              },
            },
          },
          {
            $set: {
              blockedUntil: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$count', rule.limit] },
                      { $not: [{ $gt: [{ $ifNull: ['$blockedUntil', epoch] }, now] }] },
                    ],
                  },
                  banUntil,
                  // Keep a ban that is already running (a concurrent failure must not lift it).
                  '$blockedUntil',
                ],
              },
            },
          },
          {
            $set: {
              // The row can go once both the window and the ban are over.
              expiresAt: {
                $max: [
                  { $add: ['$windowStart', rule.windowMs] },
                  { $ifNull: ['$blockedUntil', epoch] },
                ],
              },
            },
          },
        ],
        { upsert: true, updatePipeline: true },
      )
      .exec();
  }

  /** BR-001-15: a successful sign-in clears the email's counter. */
  async clear(key: string): Promise<void> {
    await this.model.deleteOne({ key: { $eq: key } }).exec();
  }
}
