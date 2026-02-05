import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { FavoriteEntity, FavoriteSchema } from './schemas/favorite.schema';
import { AuctionsModule } from '../auctions/auctions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FavoriteEntity.name, schema: FavoriteSchema },
    ]),
    AuctionsModule,
  ],
  controllers: [FavoritesController],
  providers: [FavoritesService],
})
export class FavoritesModule {}
