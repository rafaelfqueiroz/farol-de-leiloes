import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * BR-001-17/18: a server-side session, keyed by the token's `jti`. It identifies the account and
 * nothing else; personas, plan and status are read from current state on every request. Holds no
 * personal data (SC-25): ids and instants only.
 */
@Schema({ collection: 'sessions', timestamps: true })
export class SessionEntity {
  /** The token's `jti`: a random UUID (crypto.randomUUID). */
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  /**
   * DL-001-02: the account's credential version when the session was issued; the session is
   * refused once the account's version moves on. A session stored before the field counts as 0.
   */
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  credentialVersion!: number;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, required: false })
  revokedAt?: Date;
}

export type SessionDocument = HydratedDocument<SessionEntity>;
export const SessionSchema = SchemaFactory.createForClass(SessionEntity);

// BR-001-18: the database removes an expired session; isActive also checks `expiresAt` against the
// injected clock, because the TTL monitor lags by up to a minute.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
