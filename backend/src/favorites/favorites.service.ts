import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FavoriteEntity, FavoriteDocument } from './schemas/favorite.schema';
import { AuctionsService } from '../auctions/auctions.service';
import { Auction, AuctionRecord } from '../auctions/interfaces/auction.interface';
import { isAuctionActive } from '../auctions/utils/auction-filters';

// `auction` once populated: the auction record, or null when the reference is stale.
type PopulatedAuction = { auction: AuctionRecord | null };

@Injectable()
export class FavoritesService {
  constructor(
    @InjectModel(FavoriteEntity.name) private readonly favoriteRepository: Model<FavoriteDocument>,
    private readonly auctionsService: AuctionsService,
  ) {}

  async findAll(userId: string): Promise<Auction[]> {
    const favorites = await this.favoriteRepository
      .find({ userId })
      .populate<PopulatedAuction>('auction')
      .sort({ createdAt: -1 })
      .exec();

    const results: Auction[] = [];

    for (const fav of favorites) {
      if (fav.auction != null) {
        const auction = this.toAuction(fav.auction);
        // Skip inactive auctions (unavailable, past date, etc.)
        if (!isAuctionActive(auction)) {
          continue;
        }
        results.push(auction);
        continue;
      }

      // Auction ObjectId reference is stale — look up by auctionCode
      const auction = await this.auctionsService.findByCode(fav.auctionCode);
      if (auction && isAuctionActive(auction)) {
        const doc = await this.auctionsService.findDocumentByCode(fav.auctionCode);
        if (doc) {
          await this.updateAuctionId(fav._id, doc._id);
        }
        results.push(auction);
      }
    }

    return results;
  }

  private async updateAuctionId(
    favoriteId: Types.ObjectId,
    auctionId: Types.ObjectId,
  ): Promise<void> {
    await this.favoriteRepository.updateOne({ _id: favoriteId }, { $set: { auction: auctionId } });
  }

  async findOne(userId: string, auctionCode: string): Promise<FavoriteDocument | null> {
    return this.favoriteRepository.findOne({ userId, auctionCode }).exec();
  }

  async create(userId: string, auctionCode: string): Promise<Auction> {
    const existingFavorite = await this.findOne(userId, auctionCode);
    if (existingFavorite) {
      const populated = await this.favoriteRepository
        .findById(existingFavorite._id)
        .populate<PopulatedAuction>('auction')
        .exec();
      if (populated?.auction) {
        return this.toAuction(populated.auction);
      }
    }

    // Find the auction document by code (need _id for the Favorite record)
    const auctionDoc = await this.auctionsService.findDocumentByCode(auctionCode);
    if (!auctionDoc) {
      throw new NotFoundException(`Auction with code ${auctionCode} not found`);
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
      throw new NotFoundException(`Auction with code ${auctionCode} not found`);
    }
    return auction;
  }

  async remove(userId: string, auctionCode: string): Promise<boolean> {
    const result = await this.favoriteRepository.deleteOne({ userId, auctionCode }).exec();
    return result.deletedCount > 0;
  }

  private toAuction(doc: AuctionRecord): Auction {
    const phases = doc.phases ?? [];

    // Compute URLs from file objects (prefer publicUrl, fallback to originalUrl)
    const imageUrl = doc.image?.publicUrl ?? doc.image?.originalUrl ?? null;
    const matriculaUrl = doc.matricula?.publicUrl ?? doc.matricula?.originalUrl ?? null;
    // TODO: editalUrl disabled - edital is tied to auction phase, not the auction itself
    // const editalUrl = doc.edital?.publicUrl ?? doc.edital?.originalUrl ?? null;

    return {
      code: doc.code,
      title: doc.title ?? null,
      address: doc.address ?? null,
      appraisalPrice: doc.appraisalPrice ?? null,
      phases,
      currentPhase: doc.currentPhase ?? phases[phases.length - 1] ?? null,
      detailsUrl: doc.detailsUrl ?? null,
      imageUrl,
      matriculaUrl,
      editalUrl: null, // Disabled - edital is tied to auction phase
      description: doc.description ?? null,
      fulfilled: doc.fulfilled ?? false,
      available: doc.available ?? true,
      updatedAt: doc.updatedAt,
    };
  }
}
