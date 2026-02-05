import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SavedFiltersController } from './saved-filters.controller';
import { SavedFiltersService } from './saved-filters.service';
import { SavedFilterEntity, SavedFilterSchema } from './schemas/saved-filter.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SavedFilterEntity.name, schema: SavedFilterSchema },
    ]),
  ],
  controllers: [SavedFiltersController],
  providers: [SavedFiltersService],
})
export class SavedFiltersModule {}
