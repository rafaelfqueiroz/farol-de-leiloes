// AR-08: the only file that touches the favorite model. Favorites are the account's own data
// (SPEC-002 BR-002-02): every read and write is scoped to the request's account by
// AccountScopedRepository; no office ever reaches them (DL-002-08).
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { AccountScopedRepository } from '../access/account-scoped.repository.js';
import type { AccessContext } from '../access/access-context.js';
import { FavoriteEntity } from './schemas/favorite.schema.js';

/** A favorite as stored. */
export interface FavoriteRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  auctionCode: string;
  auction: Types.ObjectId;
}

@Injectable()
export class FavoritesRepository extends AccountScopedRepository<FavoriteRecord> {
  constructor(@InjectModel(FavoriteEntity.name) model: Model<FavoriteEntity>) {
    super(model as unknown as Model<FavoriteRecord>);
  }

  /** Every code the account favorited, most recent first (`_id` breaks createdAt ties). */
  async findCodes(ctx: AccessContext): Promise<string[]> {
    const favorites = await this.find(
      ctx,
      {},
      {
        select: 'auctionCode',
        sort: { createdAt: -1, _id: -1 },
      },
    );
    return favorites.map((favorite) => favorite.auctionCode);
  }

  /** The account's favorite of one auction. SC-10: the code is compared by equality. */
  findByCode(ctx: AccessContext, auctionCode: string): Promise<FavoriteRecord | null> {
    return this.findOne(ctx, { auctionCode: { $eq: auctionCode } });
  }

  /** Removes the account's favorite of one auction; answers whether there was one. */
  async removeByCode(ctx: AccessContext, auctionCode: string): Promise<boolean> {
    return (await this.deleteMany(ctx, { auctionCode: { $eq: auctionCode } })) > 0;
  }
}
