import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import businessConfig from '../config/business.config.js';
import { SavedFiltersController } from './saved-filters.controller.js';
import { SavedFiltersService } from './saved-filters.service.js';
import { SavedFilterEntity, SavedFilterSchema } from './schemas/saved-filter.schema.js';

@Module({
  imports: [
    ConfigModule.forFeature(businessConfig),
    MongooseModule.forFeature([{ name: SavedFilterEntity.name, schema: SavedFilterSchema }]),
  ],
  controllers: [SavedFiltersController],
  providers: [SavedFiltersService],
})
export class SavedFiltersModule {}
