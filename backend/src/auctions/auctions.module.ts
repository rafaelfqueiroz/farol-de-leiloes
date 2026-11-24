import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuctionsController } from './auctions.controller.js';
import { ImportRunsController } from './import-runs/import-runs.controller.js';
import { AuctionDocumentsController } from './documents/auction-documents.controller.js';
import { AuctionDocumentsService } from './documents/auction-documents.service.js';
import { AuctionsService } from './auctions.service.js';
import { AuctionEntity, AuctionSchema } from './schemas/auction.schema.js';
import { CsvUpload, CsvUploadSchema } from './importer/schemas/csv-upload.schema.js';
import { CsvCacheService } from './importer/csv-cache.service.js';
import { AuctionsImporter } from './importer/scheduler.js';
import { ImportOrchestrator } from './importer/import-orchestrator.service.js';
import { DailyUpdateBus } from './import-runs/daily-update-bus.js';
import { ImportAlertService } from './import-runs/import-alert.service.js';
import { EnrichmentPass } from './enrichment/enrichment-pass.js';
import { DetailEnrichmentPass } from './enrichment/detail-enrichment-pass.js';
import { DetailApplier } from './enrichment/detail-applier.js';
import { EnrichmentRepository } from './enrichment/enrichment.repository.js';
import { FileCopier } from './enrichment/file-copier.js';
import { PropertyCopier } from './enrichment/property-copier.js';
import { RoundClockService } from './enrichment/round-clock.service.js';
import { Sleeper, SystemSleeper } from '../common/clock/sleeper.js';
import { EmailModule } from '../email/email.module.js';
import { UsersModule } from '../users/users.module.js';
import { BusinessCalendarModule } from '../common/business-calendar.module.js';
import { ListApplier } from './importer/list-applier.service.js';
import { ListApplierRepository } from './importer/list-applier.repository.js';
import { ImportRunEntity, ImportRunSchema } from './import-runs/import-run.schema.js';
import { ImportRunRepository } from './import-runs/import-run.repository.js';
import { ImportRunService } from './import-runs/import-run.service.js';
import { PropertyChangeEntity, PropertyChangeSchema } from './changes/property-change.schema.js';
import { PropertyChangeRepository } from './changes/property-change.repository.js';
import { PropertyChangeService } from './changes/property-change.service.js';
import { AuctionCleanupService } from './cleanup/auction-cleanup.service.js';
import { CommonModule } from '../common/common.module.js';
import { StorageModule } from '../storage/storage.module.js';
import schedulerConfig, { SchedulerConfig } from '../config/scheduler.config.js';
import businessConfig from '../config/business.config.js';
import caixaConfig, { type CaixaConfig } from '../config/caixa.config.js';
import { CaixaAccess } from './caixa/caixa-access.js';
import { HttpCaixaAccess } from './caixa/http-caixa-access.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuctionEntity.name, schema: AuctionSchema },
      { name: CsvUpload.name, schema: CsvUploadSchema },
      { name: ImportRunEntity.name, schema: ImportRunSchema },
      { name: PropertyChangeEntity.name, schema: PropertyChangeSchema },
    ]),
    ConfigModule.forFeature(schedulerConfig),
    ConfigModule.forFeature(businessConfig),
    ConfigModule.forFeature(caixaConfig),
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
    EmailModule, // BR-004-29: the alert email
    UsersModule, // BR-004-29: the admins to alert (AR-09)
    BusinessCalendarModule, // BR-004-31
  ],
  controllers: [AuctionsController, ImportRunsController, AuctionDocumentsController],
  providers: [
    AuctionsService,
    AuctionDocumentsService,
    AuctionsImporter,
    ImportOrchestrator,
    DailyUpdateBus,
    ImportAlertService,
    // SPEC-004 part 4: the detail-page collection that runs after the list is applied (BR-004-18),
    // gated by SCRAPER_ENABLED; the clock's round changes run in the same completion step.
    { provide: EnrichmentPass, useClass: DetailEnrichmentPass },
    EnrichmentRepository,
    DetailApplier,
    PropertyCopier,
    FileCopier,
    RoundClockService,
    { provide: Sleeper, useClass: SystemSleeper }, // SC-24: the pause between requests is real
    ListApplier,
    ListApplierRepository,
    ImportRunService,
    ImportRunRepository,
    PropertyChangeService,
    PropertyChangeRepository,
    CsvCacheService,
    // AR-10: Caixa behind its port; HttpCaixaAccess is the one adapter (SC-24).
    {
      provide: CaixaAccess,
      useFactory: (config: CaixaConfig) => new HttpCaixaAccess(config),
      inject: [caixaConfig.KEY],
    },
    AuctionCleanupService,
  ],
  // SPEC-008 / SPEC-013 read the change entries and the Import Runs through these services (AR-09).
  exports: [AuctionsService, CacheModule, PropertyChangeService, ImportRunService, DailyUpdateBus],
})
export class AuctionsModule {}
