import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuctionsController } from './auctions.controller.js';
import { AuctionsService } from './auctions.service.js';
import { AuctionEntity, AuctionSchema } from './schemas/auction.schema.js';
import { CsvUpload, CsvUploadSchema } from './importer/schemas/csv-upload.schema.js';
import { CsvCacheService } from './importer/csv-cache.service.js';
import { AuctionsImporter } from './importer/scheduler.js';
import { AuctionDetailsScraper } from './scraper/scraper-scheduler.js';
import { AuctionCleanupService } from './cleanup/auction-cleanup.service.js';
import { CommonModule } from '../common/common.module.js';
import { StorageModule } from '../storage/storage.module.js';
import schedulerConfig, { SchedulerConfig } from '../config/scheduler.config.js';
import businessConfig from '../config/business.config.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuctionEntity.name, schema: AuctionSchema },
      { name: CsvUpload.name, schema: CsvUploadSchema },
    ]),
    ConfigModule.forFeature(schedulerConfig),
    ConfigModule.forFeature(businessConfig),
    CacheModule.registerAsync({
      imports: [ConfigModule.forFeature(schedulerConfig)],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = configService.get<SchedulerConfig>(schedulerConfig.KEY);
        return {
          ttl: config?.cache.neighborhoodsTtl ?? 3600000,
        };
      },
    }),
    CommonModule,
    StorageModule,
  ],
  controllers: [AuctionsController],
  providers: [
    AuctionsService,
    AuctionsImporter,
    CsvCacheService,
    AuctionDetailsScraper,
    AuctionCleanupService,
  ],
  exports: [AuctionsService, CacheModule],
})
export class AuctionsModule {}
