import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { serverOperators } from '../../common/mongo/query-safety.js';
import type { AccountTokenPurpose } from './account-token-purposes.js';
import { AccountTokenEntity } from './account-token.schema.js';

/** A consumed token, as a plain value (AR-09). */
export interface AccountTokenRecord {
  userId: string;
  purpose: AccountTokenPurpose;
  newEmail?: string;
}

export interface NewAccountToken {
  userId: string;
  purpose: AccountTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  newEmail?: string;
}

/** AR-08: the only file that touches the `accountTokens` model. */
@Injectable()
export class AccountTokenRepository {
  constructor(
    @InjectModel(AccountTokenEntity.name) private readonly model: Model<AccountTokenEntity>,
  ) {}

  /** Drops the user's unused tokens of one purpose, so only the newest link works (BR-001-05). */
  async deleteUnused(userId: string, purpose: AccountTokenPurpose): Promise<void> {
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
  async deleteAllButNewestUnused(userId: string, purpose: AccountTokenPurpose): Promise<void> {
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
    purpose: AccountTokenPurpose,
    now: Date,
  ): Promise<AccountTokenRecord | null> {
    const token = await this.model
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
    if (!token) return null;
    return {
      userId: token.userId.toHexString(),
      purpose: token.purpose,
      ...(token.newEmail === undefined ? {} : { newEmail: token.newEmail }),
    };
  }
}
