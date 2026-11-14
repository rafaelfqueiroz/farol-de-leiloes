import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FavoritesController } from './favorites.controller.js';
import { FavoritesService } from './favorites.service.js';
import { FavoriteEntity, FavoriteSchema } from './schemas/favorite.schema.js';
import { AuctionsModule } from '../auctions/auctions.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: FavoriteEntity.name, schema: FavoriteSchema }]),
    AuctionsModule,
  ],
  controllers: [FavoritesController],
  providers: [FavoritesService],
})
export class FavoritesModule {}
