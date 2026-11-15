import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * BR-001-15: failed sign-ins per key, `email:<normalised email>` or `ip:<address>`. Personal data
 * point (SC-25): the key holds an email or an IP, so the row lives only as long as the window or
 * the ban (`expiresAt` TTL, at most 30 minutes) and is never logged.
 */
@Schema({ collection: 'loginAttempts', timestamps: true })
export class LoginAttemptEntity {
  @Prop({ type: String, required: true, unique: true })
  key!: string;

  @Prop({ type: Number, required: true })
  count!: number;

  @Prop({ type: Date, required: true })
  windowStart!: Date;

  /** Set when the count reaches the limit: until then attempts are refused (BR-001-15). */
  @Prop({ type: Date, required: false })
  blockedUntil?: Date;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export type LoginAttemptDocument = HydratedDocument<LoginAttemptEntity>;
export const LoginAttemptSchema = SchemaFactory.createForClass(LoginAttemptEntity);

// `key` is indexed by its `unique` option. Throttling expires on its own (BR-001-15).
LoginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
