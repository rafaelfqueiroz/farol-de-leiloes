import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { serverOperators } from '../../common/mongo/query-safety.js';
import { LoginAttemptEntity } from './login-attempt.schema.js';

export interface AttemptRule {
  limit: number;
  windowMs: number;
  banMs: number;
}

/** The counter after a reservation: what the service decides on. */
export interface ReservedAttempt {
  count: number;
  blockedUntil?: Date;
}

/** AR-08: the only file that touches the `loginAttempts` model. */
@Injectable()
export class LoginAttemptsRepository {
  constructor(
    @InjectModel(LoginAttemptEntity.name) private readonly model: Model<LoginAttemptEntity>,
  ) {}

  /**
   * Counts one attempt for the key BEFORE the password is looked at, in a single atomic upsert,
   * and returns the row after the update (BR-001-15). Because the increment and the decision
   * share one server-side step, N parallel guesses are counted 1..N and only the first `limit`
   * of them can go on to cost a bcrypt comparison.
   *
   * The pipeline, evaluated on the stored row:
   *  - a running ban freezes the row (refused attempts are not counted, so hammering a banned
   *    key cannot extend the ban);
   *  - otherwise a new window starts when none is open (or the old one is over), else the count
   *    goes up by one;
   *  - when the count passes `limit` and no ban is running, the ban is set to `now + banMs`: it
   *    lasts 15 minutes from the refusal that triggered it, not from the 10th failure;
   *  - the row expires once both its window and its ban are over (TTL).
   */
  async reserve(key: string, now: Date, rule: AttemptRule): Promise<ReservedAttempt> {
    const windowCutoff = new Date(now.getTime() - rule.windowMs);
    const banUntil = new Date(now.getTime() + rule.banMs);
    const epoch = new Date(0);
    const banRunning = { $gt: [{ $ifNull: ['$blockedUntil', epoch] }, now] };
    const windowOver = { $lte: [{ $ifNull: ['$windowStart', epoch] }, windowCutoff] };

    const row = await this.model
      .findOneAndUpdate(
        { key: { $eq: key } },
        [
          {
            $set: {
              // One $set stage reads the stored values for every field it writes.
              count: {
                $cond: [
                  banRunning,
                  '$count',
                  { $cond: [windowOver, 1, { $add: [{ $ifNull: ['$count', 0] }, 1] }] },
                ],
              },
              windowStart: {
                $cond: [banRunning, '$windowStart', { $cond: [windowOver, now, '$windowStart'] }],
              },
            },
          },
          {
            $set: {
              blockedUntil: {
                $cond: [
                  { $and: [{ $gt: ['$count', rule.limit] }, { $not: [banRunning] }] },
                  banUntil,
                  // Keep a ban that is already running.
                  '$blockedUntil',
                ],
              },
            },
          },
          {
            $set: {
              expiresAt: {
                $max: [
                  { $add: ['$windowStart', rule.windowMs] },
                  { $ifNull: ['$blockedUntil', epoch] },
                ],
              },
            },
          },
        ],
        { upsert: true, returnDocument: 'after', updatePipeline: true },
      )
      .lean()
      .exec();

    return { count: row.count, ...(row.blockedUntil ? { blockedUntil: row.blockedUntil } : {}) };
  }

  /** BR-001-15: a successful sign-in clears the email's counter. */
  async clear(key: string): Promise<void> {
    await this.model.deleteOne({ key: { $eq: key } }).exec();
  }

  /** Gives back the count a successful attempt reserved on the origin; never below zero. */
  async release(key: string): Promise<void> {
    await this.model
      .updateOne({ key: { $eq: key }, count: serverOperators({ $gt: 0 }) }, { $inc: { count: -1 } })
      .exec();
  }
}
