import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FavoriteEntity, FavoriteDocument } from './schemas/favorite.schema.js';
import { AuctionsService } from '../auctions/auctions.service.js';
import { Auction, AuctionRecord } from '../auctions/interfaces/auction.interface.js';
import { DomainError } from '../common/errors/domain-error.js';
import {
  type PageRequest,
  type Paginated,
  pageOfList,
  paginated,
} from '../common/pagination/paginated.js';

// `auction` once populated: the auction record, or null when the reference is stale.
type PopulatedAuction = { auction: AuctionRecord | null };

@Injectable()
export class FavoritesService {
  constructor(
    @InjectModel(FavoriteEntity.name) private readonly favoriteRepository: Model<FavoriteDocument>,
    private readonly auctionsService: AuctionsService,
  ) {}

  /**
   * AR-35: one page of the user's favorited auctions that are still active, most recently
   * favorited first (`_id` breaks createdAt ties). Favorites point at auctions by code, so a
   * re-imported auction (new `_id`) is still found. The active check needs each auction's phases,
   * so the user's codes are filtered first (light projection) and only the page is loaded whole.
   */
  async findPage(userId: string, page: PageRequest): Promise<Paginated<Auction>> {
    const codes = await this.findCodes(userId);
    const active = await this.auctionsService.findActiveCodes(codes);
    const { items: pageCodes, total } = pageOfList(
      codes.filter((code) => active.has(code)),
      page,
    );
    const auctions = new Map(
      (await this.auctionsService.findAvailableByCodes(pageCodes)).map((a) => [a.code, a]),
    );
    const items = pageCodes.flatMap((code) => auctions.get(code) ?? []);
    return paginated(items, total, page);
  }

  /** AR-12: every code the user favorited, active or not, most recent first; never another's. */
  async findCodes(userId: string): Promise<string[]> {
    const favorites = await this.favoriteRepository
      .find({ userId })
      .select('auctionCode')
      .sort({ createdAt: -1, _id: -1 })
      .lean()
      .exec();
    return favorites.map((favorite) => favorite.auctionCode);
  }

  async findOne(userId: string, auctionCode: string): Promise<FavoriteDocument | null> {
    // SC-10: both values are compared by equality, whatever they hold; neither can be an operator.
    if (typeof userId !== 'string' || typeof auctionCode !== 'string') return null;
    return this.favoriteRepository
      .findOne({ userId: { $eq: userId }, auctionCode: { $eq: auctionCode } })
      .exec();
  }

  async create(userId: string, auctionCode: string): Promise<Auction> {
    const existingFavorite = await this.findOne(userId, auctionCode);
    if (existingFavorite) {
      const populated = await this.favoriteRepository
        .findById(existingFavorite._id)
        .populate<PopulatedAuction>('auction')
        .exec();
      if (populated?.auction) {
        // AuctionsService maps the stored record, money included (AR-17, AR-09).
        return this.auctionsService.toAuction(populated.auction);
      }
    }

    // Find the auction document by code (need _id for the Favorite record)
    const auctionDoc = await this.auctionsService.findDocumentByCode(auctionCode);
    if (!auctionDoc) {
      throw new DomainError('AUCTION_NOT_FOUND');
    }

    const favorite = new this.favoriteRepository({
      userId,
      auctionCode,
      auction: auctionDoc._id,
    });
    await favorite.save();

    // findByCode only returns available auctions; an unavailable one is reported as not found
    // (DV-03) instead of returning null to the controller.
    const auction = await this.auctionsService.findByCode(auctionCode);
    if (!auction) {
      throw new DomainError('AUCTION_NOT_FOUND');
    }
    return auction;
  }

  async remove(userId: string, auctionCode: string): Promise<boolean> {
    const result = await this.favoriteRepository.deleteOne({ userId, auctionCode }).exec();
    return result.deletedCount > 0;
  }
}
