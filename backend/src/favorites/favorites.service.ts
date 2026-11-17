import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../access/access-context.js';
import { FavoritesRepository, type FavoriteRecord } from './favorites.repository.js';
import { AuctionsService } from '../auctions/auctions.service.js';
import { Auction } from '../auctions/interfaces/auction.interface.js';
import { DomainError } from '../common/errors/domain-error.js';
import {
  type PageRequest,
  type Paginated,
  pageOfList,
  paginated,
} from '../common/pagination/paginated.js';

@Injectable()
export class FavoritesService {
  constructor(
    // AR-08 / SPEC-002 BR-002-02: the account's own data, through its account-scoped repository.
    private readonly favorites: FavoritesRepository,
    private readonly auctionsService: AuctionsService,
  ) {}

  /**
   * AR-35: one page of the account's favorited auctions that are still active, most recently
   * favorited first (`_id` breaks createdAt ties). Favorites point at auctions by code, so a
   * re-imported auction (new `_id`) is still found. The active check needs each auction's phases,
   * so the account's codes are filtered first (light projection) and only the page is loaded whole.
   */
  async findPage(ctx: AccessContext, page: PageRequest): Promise<Paginated<Auction>> {
    const codes = await this.findCodes(ctx);
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

  /** BR-002-02: every code the account favorited, active or not, most recent first; never another's. */
  findCodes(ctx: AccessContext): Promise<string[]> {
    return this.favorites.findCodes(ctx);
  }

  async findOne(ctx: AccessContext, auctionCode: string): Promise<FavoriteRecord | null> {
    // SC-10: compared by equality, whatever it holds; a non-string is never a favorite.
    if (typeof auctionCode !== 'string') return null;
    return this.favorites.findByCode(ctx, auctionCode);
  }

  async create(ctx: AccessContext, auctionCode: string): Promise<Auction> {
    const existingFavorite = await this.findOne(ctx, auctionCode);
    if (existingFavorite) {
      // The auction the favorite points at, whatever its availability (as a populate would).
      const favorited = await this.auctionsService.findDocumentById(
        existingFavorite.auction.toString(),
      );
      if (favorited) {
        // AuctionsService maps the stored record, money included (AR-17, AR-09).
        return this.auctionsService.toAuction(favorited);
      }
    }

    // Find the auction document by code (need _id for the Favorite record)
    const auctionDoc = await this.auctionsService.findDocumentByCode(auctionCode);
    if (!auctionDoc) {
      throw new DomainError('AUCTION_NOT_FOUND');
    }

    await this.favorites.create(ctx, { auctionCode, auction: auctionDoc._id });

    // findByCode only returns available auctions; an unavailable one is reported as not found
    // (DV-03) instead of returning null to the controller.
    const auction = await this.auctionsService.findByCode(auctionCode);
    if (!auction) {
      throw new DomainError('AUCTION_NOT_FOUND');
    }
    return auction;
  }

  async remove(ctx: AccessContext, auctionCode: string): Promise<boolean> {
    if (typeof auctionCode !== 'string') return false; // SC-10
    return this.favorites.removeByCode(ctx, auctionCode);
  }
}
