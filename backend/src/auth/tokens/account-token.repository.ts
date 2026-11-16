import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { serverOperators } from '../../common/mongo/query-safety.js';
import type { AccountTokenPurpose, UserTokenPurpose } from './account-token-purposes.js';
import { AccountTokenEntity } from './account-token.schema.js';

/** A consumed token of an account, as a plain value (AR-09). */
export interface AccountTokenRecord {
  userId: string;
  purpose: UserTokenPurpose;
  newEmail?: string;
}

/** What Google vouched for about a person who has no account yet (BR-001-08, BR-001-09). */
export interface GoogleSignupProfile {
  googleId: string;
  email: string;
  name: string;
}

export interface NewAccountToken {
  userId: string;
  purpose: UserTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  newEmail?: string;
}

export interface NewGoogleSignupToken {
  tokenHash: string;
  expiresAt: Date;
  profile: GoogleSignupProfile;
}

/** AR-08: the only file that touches the `accountTokens` model. */
@Injectable()
export class AccountTokenRepository {
  constructor(
    @InjectModel(AccountTokenEntity.name) private readonly model: Model<AccountTokenEntity>,
  ) {}

  /** Drops the user's unused tokens of one purpose, so only the newest link works (BR-001-05). */
  async deleteUnused(userId: string, purpose: UserTokenPurpose): Promise<void> {
    await this.model
      .deleteMany({ userId: { $eq: new Types.ObjectId(userId) }, purpose, usedAt: null })
      .exec();
  }

  /**
   * Leaves only the newest unused token (highest `_id`) of the user and purpose. Run after an
   * insert, from every issuer: whichever cleanup runs last has seen every insert acknowledged
   * before it, so concurrent issuers always end with exactly one valid link (BR-001-05,
   * BR-001-22). Deleting "everything but mine" instead would let two issuers delete each other's
   * token and leave none.
   */
  async deleteAllButNewestUnused(userId: string, purpose: UserTokenPurpose): Promise<void> {
    const filter = {
      userId: { $eq: new Types.ObjectId(userId) },
      purpose: { $eq: purpose },
      usedAt: null,
    };
    const newest = await this.model.findOne(filter).sort({ _id: -1 }).select('_id').lean().exec();
    if (!newest) return;
    await this.model.deleteMany({ ...filter, _id: serverOperators({ $lt: newest._id }) }).exec();
  }

  async insert(token: NewAccountToken): Promise<void> {
    await this.model.create({ ...token, userId: new Types.ObjectId(token.userId) });
  }

  /**
   * Marks the token used and returns it, in one atomic step: of two concurrent requests with the
   * same link exactly one gets the record (BR-001-05, BR-001-22). Null when the hash is unknown,
   * the purpose differs, the token was used, or it expired at `now`.
   */
  async consume(
    tokenHash: string,
    purpose: UserTokenPurpose,
    now: Date,
  ): Promise<AccountTokenRecord | null> {
    const token = await this.markUsed(tokenHash, purpose, now);
    if (!token?.userId) return null;
    return {
      userId: token.userId.toHexString(),
      purpose,
      ...(token.newEmail === undefined ? {} : { newEmail: token.newEmail }),
    };
  }

  /** Deletes the user's unused tokens of every purpose (BR-001-10: linking ends outstanding links). */
  async deleteAllUnusedForUser(userId: string): Promise<void> {
    await this.model
      .deleteMany({ userId: { $eq: new Types.ObjectId(userId) }, usedAt: null })
      .exec();
  }

  async insertGoogleSignup(token: NewGoogleSignupToken): Promise<void> {
    await this.model.create({ ...token, purpose: 'google_signup' });
  }

  /** The profile of a live `google_signup` token, without spending it (BR-001-09). */
  async findGoogleSignup(tokenHash: string, now: Date): Promise<GoogleSignupProfile | null> {
    const token = await this.model
      .findOne({
        tokenHash: { $eq: tokenHash },
        purpose: { $eq: 'google_signup' },
        usedAt: null,
        expiresAt: serverOperators({ $gt: now }),
      })
      .lean()
      .exec();
    return token?.profile ? toProfile(token.profile) : null;
  }

  /**
   * Spends a `google_signup` token and returns its profile, in one atomic step: of two concurrent
   * requests with the same code exactly one gets the profile. The document is deleted, not just
   * marked, so the personal data it holds does not outlive its use (BR-001-09, SC-25).
   */
  async consumeGoogleSignup(tokenHash: string, now: Date): Promise<GoogleSignupProfile | null> {
    const token = await this.model
      .findOneAndDelete({
        tokenHash: { $eq: tokenHash },
        purpose: { $eq: 'google_signup' },
        usedAt: null,
        expiresAt: serverOperators({ $gt: now }),
      })
      .lean()
      .exec();
    return token?.profile ? toProfile(token.profile) : null;
  }

  /** Deletes an unused `google_signup` token: declining leaves nothing stored (BR-010-01). */
  async deleteGoogleSignup(tokenHash: string): Promise<void> {
    await this.model
      .deleteOne({
        tokenHash: { $eq: tokenHash },
        purpose: { $eq: 'google_signup' },
        usedAt: null,
      })
      .exec();
  }

  private markUsed(tokenHash: string, purpose: AccountTokenPurpose, now: Date) {
    return this.model
      .findOneAndUpdate(
        {
          tokenHash: { $eq: tokenHash },
          purpose: { $eq: purpose },
          usedAt: null,
          expiresAt: serverOperators({ $gt: now }),
        },
        { $set: { usedAt: now } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
  }
}

/** A plain copy of the stored sub-document (AR-09). */
function toProfile(stored: GoogleSignupProfile): GoogleSignupProfile {
  return { googleId: stored.googleId, email: stored.email, name: stored.name };
}
