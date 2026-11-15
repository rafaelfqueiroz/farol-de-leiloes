import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ACCOUNT_TOKEN_PURPOSES, type AccountTokenPurpose } from './account-token-purposes.js';

/**
 * BR-001-23 / SC-06: a single-use link token. Only the SHA-256 of the token is stored, so a
 * database read never yields a usable link. Not owned client data (no ownerId, AR-16): it is
 * account infrastructure, scoped by `userId`.
 */
@Schema({ collection: 'accountTokens', timestamps: true })
export class AccountTokenEntity {
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ACCOUNT_TOKEN_PURPOSES })
  purpose!: AccountTokenPurpose;

  @Prop({ type: String, required: true, unique: true })
  tokenHash!: string;

  /**
   * The address the token is bound to: the one a confirmation link was mailed to
   * (`email_confirmation`), or the one waiting for confirmation (`email_change`, BR-001-26).
   */
  @Prop({ type: String, required: false })
  newEmail?: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, required: false })
  usedAt?: Date;
}

export type AccountTokenDocument = HydratedDocument<AccountTokenEntity>;
export const AccountTokenSchema = SchemaFactory.createForClass(AccountTokenEntity);

// `tokenHash` is indexed by its `unique` option. AR-27: issuing deletes by user and purpose.
AccountTokenSchema.index({ userId: 1, purpose: 1 });
// The database drops an expired token on its own; the service never trusts that and also checks
// `expiresAt` against the injected clock (the TTL monitor runs about once a minute).
AccountTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
