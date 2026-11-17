import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';

/**
 * BR-001-15: the sign-in attempts of one key, `email:<normalised email>` or `ip:<address>`, over a
 * ROLLING window. Personal data point (SC-25): the key holds an email or an IP, so the row lives
 * only as long as its latest attempt is inside the window or a ban runs (`expiresAt` TTL, at most
 * 15 minutes after the latest counted attempt) and is never logged.
 *
 * The collection is new in this PR (no deployed data), so this shape needs no migration.
 */
@Schema({ collection: 'loginAttempts', timestamps: true })
export class LoginAttemptEntity {
  @Prop({ type: String, required: true, unique: true })
  key!: string;

  /**
   * The instants of the attempts inside the window, oldest first: every attempt newer than
   * `now - windowMs` (an attempt exactly one window old no longer counts), capped at the newest
   * `limit + 1`. Nothing else about an attempt is stored.
   */
  @Prop({ type: [Date], required: true, default: [] })
  attempts!: Date[];

  /** The number of entries in `attempts`, kept for reading the row; the repository derives it. */
  @Prop({ type: Number, required: true })
  count!: number;

  /**
   * Set when `count` passes the limit: until then attempts are refused (BR-001-15). It runs 15
   * minutes from the refusal that triggered it, and refused attempts neither count nor move it.
   */
  @Prop({ type: Date, required: false })
  blockedUntil?: Date;

  /** The later of the latest attempt plus the window and the end of the ban (TTL, BR-001-15). */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export type LoginAttemptDocument = HydratedDocument<LoginAttemptEntity>;
export const LoginAttemptSchema = SchemaFactory.createForClass(LoginAttemptEntity);

// AR-16 / TS-14: the isolation class of this collection.
markIsolation(LoginAttemptSchema, {
  kind: 'internal',
  reason: 'SPEC-001 sign-in throttling counters keyed by a hash; never read by any account',
});

// `key` is indexed by its `unique` option. Throttling expires on its own (BR-001-15).
LoginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
