import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ACCOUNT_TOKEN_PURPOSES, type AccountTokenPurpose } from './account-token-purposes.js';
import { markIsolation } from '../../access/isolation-mark.js';

// A sub-document, not a nested path: a nested path's `required` members would fail every other
// purpose's token, which has no profile.
const GoogleSignupProfileSchema = new MongooseSchema(
  {
    googleId: { type: String, required: true },
    email: { type: String, required: true },
    name: { type: String, required: true },
  },
  { _id: false },
);

/**
 * BR-001-23 / SC-06: a single-use link token. Only the SHA-256 of the token is stored, so a
 * database read never yields a usable link. Not owned client data (no ownerId, AR-16): it is
 * account infrastructure, scoped by `userId`.
 */
@Schema({ collection: 'accountTokens', timestamps: true })
export class AccountTokenEntity {
  /** Absent on `google_signup`: that token exists before the account does (BR-001-09). */
  @Prop({ type: Types.ObjectId, required: false })
  userId?: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ACCOUNT_TOKEN_PURPOSES })
  purpose!: AccountTokenPurpose;

  @Prop({ type: String, required: true, unique: true })
  tokenHash!: string;

  /**
   * The address a confirmation link was mailed to (`email_confirmation`), so the link can only
   * confirm that address.
   */
  @Prop({ type: String, required: false })
  newEmail?: string;

  /**
   * `google_signup` only: the verified Google profile of a person who has no account yet, kept
   * until they accept the terms or the token expires (BR-001-09, BR-010-01). Personal data
   * (SC-25 inventory): never logged (SC-15), at most 15 minutes, deleted when declined or spent.
   */
  @Prop({ type: GoogleSignupProfileSchema, required: false })
  profile?: { googleId: string; email: string; name: string };

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, required: false })
  usedAt?: Date;
}

export type AccountTokenDocument = HydratedDocument<AccountTokenEntity>;
export const AccountTokenSchema = SchemaFactory.createForClass(AccountTokenEntity);

// AR-16 / TS-14: the isolation class of this collection.
markIsolation(AccountTokenSchema, {
  kind: 'internal',
  reason:
    'SPEC-001 one-time tokens (email confirmation, password reset, Google exchange), found by their hash; never listed',
});

// `tokenHash` is indexed by its `unique` option. AR-27: issuing deletes by user and purpose.
AccountTokenSchema.index({ userId: 1, purpose: 1 });
// The database drops an expired token on its own; the service never trusts that and also checks
// `expiresAt` against the injected clock (the TTL monitor runs about once a minute).
AccountTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
