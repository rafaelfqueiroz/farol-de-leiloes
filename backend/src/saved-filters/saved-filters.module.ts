import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import businessConfig from '../config/business.config.js';
import { SavedFiltersController } from './saved-filters.controller.js';
import { SavedFiltersRepository } from './saved-filters.repository.js';
import { SavedFiltersService } from './saved-filters.service.js';
import { SavedFilterEntity, SavedFilterSchema } from './schemas/saved-filter.schema.js';
import { SavedFiltersPersonalData } from './saved-filters.personal-data.js';
import { PersonalDataRegistryModule } from '../privacy/registry/personal-data-registry.module.js';

@Module({
  imports: [
    ConfigModule.forFeature(businessConfig),
    MongooseModule.forFeature([{ name: SavedFilterEntity.name, schema: SavedFilterSchema }]),
    PersonalDataRegistryModule, // SPEC-010: registered for export and purge
  ],
  controllers: [SavedFiltersController],
  providers: [SavedFiltersService, SavedFiltersRepository, SavedFiltersPersonalData],
})
export class SavedFiltersModule {}
