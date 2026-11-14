import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import businessConfig from '../config/business.config';
import { SavedFiltersController } from './saved-filters.controller';
import { SavedFiltersService } from './saved-filters.service';
import { SavedFilterEntity, SavedFilterSchema } from './schemas/saved-filter.schema';

@Module({
  imports: [
    ConfigModule.forFeature(businessConfig),
    MongooseModule.forFeature([{ name: SavedFilterEntity.name, schema: SavedFilterSchema }]),
  ],
  controllers: [SavedFiltersController],
  providers: [SavedFiltersService],
})
export class SavedFiltersModule {}
