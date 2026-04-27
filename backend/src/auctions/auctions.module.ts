import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';
import { AuctionEntity, AuctionSchema } from './schemas/auction.schema';
import { CsvUpload, CsvUploadSchema } from './importer/schemas/csv-upload.schema';
import { CsvCacheService } from './importer/csv-cache.service';
import { AuctionsImporter } from './importer/scheduler';
import { AuctionDetailsScraper } from './scraper/scraper-scheduler';
import { AuctionCleanupService } from './cleanup/auction-cleanup.service';
import { CommonModule } from '../common/common.module';
import { StorageModule } from '../storage/storage.module';
import schedulerConfig, { SchedulerConfig } from '../config/scheduler.config';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuctionEntity.name, schema: AuctionSchema },
      { name: CsvUpload.name, schema: CsvUploadSchema },
    ]),
    ConfigModule.forFeature(schedulerConfig),
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
  providers: [AuctionsService, AuctionsImporter, CsvCacheService, AuctionDetailsScraper, AuctionCleanupService],
  exports: [AuctionsService, CacheModule],
})
export class AuctionsModule {}

