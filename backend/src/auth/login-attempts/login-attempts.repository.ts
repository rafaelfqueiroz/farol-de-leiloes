import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
   * The window is rolling. The row keeps the instants of the attempts inside the half-open
   * interval `(now - windowMs, now]`; the count is how many there are, never a counter that
   * resets as a whole. The pipeline, evaluated on the stored row:
   *  - a running ban freezes the row (refused attempts are not counted, so hammering a banned
   *    key cannot extend the ban);
   *  - otherwise the attempts that left the window are dropped, this one is appended and only the
   *    newest `limit + 1` are kept (one more than the limit is all the decision needs);
   *  - when the count passes `limit` and no ban is running, the ban is set to `now + banMs`: it
   *    lasts 15 minutes from the refusal that triggered it, not from the 10th failure;
   *  - the row expires once its latest attempt has left the window and its ban is over (TTL).
   */
  async reserve(key: string, now: Date, rule: AttemptRule): Promise<ReservedAttempt> {
    const windowCutoff = new Date(now.getTime() - rule.windowMs);
    const banUntil = new Date(now.getTime() + rule.banMs);
    const epoch = new Date(0);
    const stored = { $ifNull: ['$attempts', []] };
    const banRunning = { $gt: [{ $ifNull: ['$blockedUntil', epoch] }, now] };

    const row = await this.model
      .findOneAndUpdate(
        { key: { $eq: key } },
        [
          {
            $set: {
              attempts: {
                $cond: [
                  banRunning,
                  stored,
                  {
                    $slice: [
                      {
                        $concatArrays: [
                          // (now - window, now]: an attempt exactly one window old is out.
                          { $filter: { input: stored, cond: { $gt: ['$$this', windowCutoff] } } },
                          [now],
                        ],
                      },
                      -(rule.limit + 1),
                    ],
                  },
                ],
              },
            },
          },
          {
            $set: {
              count: { $size: '$attempts' },
              blockedUntil: {
                $cond: [
                  { $and: [{ $gt: [{ $size: '$attempts' }, rule.limit] }, { $not: [banRunning] }] },
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
                  { $add: [{ $arrayElemAt: ['$attempts', -1] }, rule.windowMs] },
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

  /**
   * Gives back the reservation a successful attempt made on the origin: removes ONE entry equal to
   * `at`, the instant `reserve` was called with. Two attempts of the same millisecond are
   * interchangeable, so one is enough; an entry that already left the window (or the cap) is gone
   * and nothing happens. The count follows; `expiresAt` is left as it was, which can only keep the row
   * a little longer than needed, never shorter.
   */
  async release(key: string, at: Date): Promise<void> {
    await this.model
      .updateOne(
        { key: { $eq: key }, attempts: { $eq: at } },
        [
          {
            $set: {
              attempts: {
                $reduce: {
                  input: '$attempts',
                  initialValue: { kept: [], removed: false },
                  in: {
                    $cond: [
                      { $and: [{ $not: ['$$value.removed'] }, { $eq: ['$$this', at] }] },
                      { kept: '$$value.kept', removed: true },
                      {
                        kept: { $concatArrays: ['$$value.kept', ['$$this']] },
                        removed: '$$value.removed',
                      },
                    ],
                  },
                },
              },
            },
          },
          { $set: { attempts: '$attempts.kept' } },
          { $set: { count: { $size: '$attempts' } } },
        ],
        { updatePipeline: true },
      )
      .exec();
  }
}
