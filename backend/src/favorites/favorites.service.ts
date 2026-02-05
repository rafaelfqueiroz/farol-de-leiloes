import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FavoriteEntity, FavoriteDocument } from './schemas/favorite.schema';
import { AuctionsService } from '../auctions/auctions.service';
import { Auction } from '../auctions/interfaces/auction.interface';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectModel(FavoriteEntity.name) private readonly favoriteRepository: Model<FavoriteDocument>,
    private readonly auctionsService: AuctionsService,
  ) {}

  async findAll(userId: string): Promise<Auction[]> {
    const favorites = await this.favoriteRepository
      .find({ userId })
      .populate('auction')
      .sort({ createdAt: -1 })
      .exec();

    const results: Auction[] = [];

    for (const fav of favorites) {
      if (fav.auction != null) {
        results.push(this.toAuction(fav.auction));
        continue;
      }

      // Auction ObjectId reference is stale — look up by auctionCode
      const auction = await this.auctionsService.findByCode(fav.auctionCode);
      if (auction) {
        const doc = await this.auctionsService.findDocumentByCode(fav.auctionCode);
        if (doc) {
          await this.updateAuctionId(fav._id, doc._id);
        }
        results.push(auction);
      }
    }

    return results;
  }

  private async updateAuctionId(favoriteId: any, auctionId: any): Promise<void> {
    await this.favoriteRepository.updateOne(
      { _id: favoriteId },
      { $set: { auction: auctionId } },
    );
  }

  async findOne(userId: string, auctionCode: string): Promise<FavoriteDocument | null> {
    return this.favoriteRepository.findOne({ userId, auctionCode }).exec();
  }

  async create(userId: string, auctionCode: string): Promise<Auction> {
    const existingFavorite = await this.findOne(userId, auctionCode);
    if (existingFavorite) {
      const populated = await this.favoriteRepository
        .findById(existingFavorite._id)
        .populate('auction')
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

    const auction = await this.auctionsService.findByCode(auctionCode);
    return auction!;
  }

  async remove(userId: string, auctionCode: string): Promise<boolean> {
    const result = await this.favoriteRepository.deleteOne({ userId, auctionCode }).exec();
    return result.deletedCount > 0;
  }

  private toAuction(doc: any): Auction {
    return {
      code: doc.code,
      title: doc.title ?? null,
      address: doc.address ?? null,
      appraisalPrice: doc.appraisalPrice ?? null,
      phases: doc.phases ?? [],
      detailsUrl: doc.detailsUrl ?? null,
      imageUrl: doc.imageUrl ?? null,
      description: doc.description ?? null,
      fulfilled: doc.fulfilled ?? false,
      available: doc.available ?? true,
      updatedAt: doc.updatedAt,
    };
  }
}
