import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FavoritesController } from './favorites.controller.js';
import { FavoritesRepository } from './favorites.repository.js';
import { FavoritesService } from './favorites.service.js';
import { FavoriteEntity, FavoriteSchema } from './schemas/favorite.schema.js';
import { AuctionsModule } from '../auctions/auctions.module.js';
import { FavoritesPersonalData } from './favorites.personal-data.js';
import { PersonalDataRegistryModule } from '../privacy/registry/personal-data-registry.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: FavoriteEntity.name, schema: FavoriteSchema }]),
    AuctionsModule,
    PersonalDataRegistryModule, // SPEC-010: registered for export and purge
  ],
  controllers: [FavoritesController],
  providers: [FavoritesService, FavoritesRepository, FavoritesPersonalData],
})
export class FavoritesModule {}
