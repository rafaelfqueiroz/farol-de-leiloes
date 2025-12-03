import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Favorite } from './schemas/favorite.schema';
import { AuctionsService } from '../auctions/auctions.service';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectModel(Favorite.name) private favoriteModel: Model<Favorite>,
    private auctionsService: AuctionsService,
  ) {}

  async findAll(userId: string): Promise<any[]> {
    const favorites = await this.favoriteModel
      .find({ userId })
      .populate('auction')
      .sort({ createdAt: -1 })
      .exec();

    // Filter out favorites where auction was deleted (null after populate)
    return favorites
      .filter(fav => fav.auction != null)
      .map(fav => fav.auction);
  }

  async findOne(userId: string, auctionCode: string): Promise<Favorite | null> {
    return this.favoriteModel.findOne({ userId, auctionCode }).exec();
  }

  async create(userId: string, auctionCode: string): Promise<any> {
    const existingFavorite = await this.findOne(userId, auctionCode);
    if (existingFavorite) {
      // Return the auction data for existing favorite
      const populated = await this.favoriteModel
        .findById(existingFavorite._id)
        .populate('auction')
        .exec();
      return populated?.auction;
    }

    // Find the auction by code
    const auction = await this.auctionsService.findByCode(auctionCode);
    if (!auction) {
      throw new NotFoundException(`Auction with code ${auctionCode} not found`);
    }

    // Create favorite with userId, code and ObjectId reference
    const favorite = new this.favoriteModel({
      userId,
      auctionCode: auctionCode,
      auction: auction._id,
    });
    await favorite.save();

    // Return the auction data
    return auction;
  }

  async remove(userId: string, auctionCode: string): Promise<boolean> {
    const result = await this.favoriteModel.deleteOne({ userId, auctionCode }).exec();
    return result.deletedCount > 0;
  }
}
