import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuctionEntity,
  AuctionDocument,
  AuctionFile,
  StoredPhase,
} from '../schemas/auction.schema';
import { restorePhase } from '../auction.mapper';
import { fetchAndScrapeDetails } from './details-scraper';
import { JobExecutionService } from '../../common/services/job-execution.service';
import { RunMode } from '../../common/schemas/job-execution.schema';
import schedulerConfig, { SchedulerConfig } from '../../config/scheduler.config';
import { StorageService } from '../../storage/storage.service';
import { errorMessage } from '../../common/error-message';
import { serverOperators } from '../../common/mongo/query-safety';
import { Clock } from '../../common/clock/clock';
import { BRASILIA_TIME_ZONE } from '../../common/clock/brasilia-time';

@Injectable()
export class AuctionDetailsScraper implements OnModuleInit {
  private readonly logger = new Logger(AuctionDetailsScraper.name);
  private readonly jobName = 'auction-details-scraper';
  private readonly batchSize = 15; // Process 10 auctions at a time
  private readonly concurrency = 3; // Process 3 auctions in parallel within each batch
  private readonly delayBetweenGroups = 500; // 500ms delay between concurrent groups

  constructor(
    @InjectModel(AuctionEntity.name) private readonly auctionModel: Model<AuctionDocument>,
    private readonly jobExecutionService: JobExecutionService,
    private readonly storageService: StorageService,
    @Inject(schedulerConfig.KEY)
    private readonly config: SchedulerConfig,
    private readonly clock: Clock, // AR-24
  ) {}

  /**
   * Log on module initialization to confirm scraper is loaded
   * Run on startup only if SCRAPER_ON_START_UP=true
   */
  async onModuleInit() {
    const { enabled, onStartup } = this.config.scraper;

    if (!enabled) {
      this.logger.log('Scraper is disabled (SCRAPER_ENABLED=false)');
      return;
    }

    this.logger.log(
      'Auction details scraper initialized. Scheduled to run daily at 06:00 Brasília',
    );

    if (onStartup) {
      this.logger.log('Running scraper on startup (SCRAPER_ON_START_UP=true)');
      setTimeout(() => this.runScraper(RunMode.MANUAL), 5000);
    } else {
      this.logger.log(
        'Skipping startup scraper (SCRAPER_ON_START_UP=false), will run on schedule only',
      );
    }
  }

  /**
   * Runs daily at 06:00 in Brasília. AR-25 / BR-003-27: the zone is explicit on the cron, so the
   * time no longer depends on the server running in UTC (it was '0 9 * * *' in server time).
   */
  @Cron('0 6 * * *', { timeZone: BRASILIA_TIME_ZONE })
  async dailyScraperJob() {
    const { enabled } = this.config.scraper;

    if (!enabled) {
      this.logger.log('Scraper is disabled (SCRAPER_ENABLED=false), skipping scheduled job');
      return;
    }

    // Scheduled job always runs (if enabled), regardless of onStartup setting
    // Check if job ran recently to prevent duplicate runs
    const ranRecently = await this.jobExecutionService.hasRunRecently(
      this.jobName,
      RunMode.AUTO,
      23, // Within last 23 hours
    );

    if (ranRecently) {
      this.logger.log('Job ran recently, skipping scheduled execution');
      return;
    }

    await this.runScraper(RunMode.AUTO);
  }

  private async runScraper(runMode: RunMode) {
    this.logger.log(`Starting auction details scraping job (${runMode} mode)`);
    try {
      await this.scrapeAuctionDetails();

      // Record execution in database
      await this.jobExecutionService.recordExecution(this.jobName, runMode);
      this.logger.log('Execution recorded in database');
    } catch (e) {
      this.logger.error(`Failed scraping: ${errorMessage(e)}`);
      throw e;
    }
  }

  /**
   * Main scraping logic - finds auctions that are not fulfilled yet
   * and scrapes their details
   */
  private async scrapeAuctionDetails() {
    try {
      // Find auctions where fulfilled = false or doesn't exist, and have a detailsUrl
      const auctionsToScrape = await this.auctionModel
        .find({
          detailsUrl: serverOperators({ $exists: true, $ne: null }),
          $or: serverOperators([{ fulfilled: { $exists: false } }, { fulfilled: false }]),
        })
        .lean();

      this.logger.log(`Found ${auctionsToScrape.length} unfulfilled auctions to scrape`);

      if (auctionsToScrape.length === 0) {
        this.logger.log('No auctions to scrape');
        return;
      }

      let scrapedCount = 0;
      let errorCount = 0;

      // Process in batches, with concurrent groups within each batch
      for (let i = 0; i < auctionsToScrape.length; i += this.batchSize) {
        const batch = auctionsToScrape.slice(i, i + this.batchSize);

        this.logger.log(
          `Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(auctionsToScrape.length / this.batchSize)}`,
        );

        // Process concurrent groups within the batch
        for (let j = 0; j < batch.length; j += this.concurrency) {
          const group = batch.slice(j, j + this.concurrency);
          const results = await Promise.allSettled(
            group.map((auction) => this.processAuction(auction)),
          );

          for (const [k, result] of results.entries()) {
            if (result.status === 'fulfilled') {
              scrapedCount += result.value ? 1 : 0;
            } else {
              errorCount++;
              this.logger.error(
                `Error scraping auction ${group[k]?.code}: ${errorMessage(result.reason)}`,
              );
            }
          }

          await this.delay(this.delayBetweenGroups);
        }
      }

      this.logger.log(`Scraping completed: ${scrapedCount} images scraped, ${errorCount} errors`);
    } catch (error) {
      this.logger.error(`Failed to scrape auction details: ${errorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Processes a single auction: scrape details, upload files, update DB.
   * Returns true if successfully processed, false if skipped.
   */
  private async processAuction(auction: AuctionEntity): Promise<boolean> {
    if (!auction.detailsUrl) return false;

    const details = await fetchAndScrapeDetails(auction.detailsUrl);

    if (details.unavailable) {
      await this.auctionModel.updateOne(
        { code: auction.code },
        { $set: { available: false, fulfilled: true, updatedAt: this.clock.now() } },
      );
      this.logger.log(`Auction ${auction.code} marked as unavailable`);
      return true;
    }

    const updateData: Record<string, unknown> = {
      fulfilled: true,
      updatedAt: this.clock.now(),
    };

    if (details.description && !auction.description) {
      updateData.description = details.description;
      this.logger.debug(`Scraped description for auction ${auction.code}`);
    }

    if (this.storageService.isConfigured()) {
      if (details.imageUrl && !auction.image?.publicUrl) {
        const imageFile: AuctionFile = {
          originalUrl: details.imageUrl,
          mimeType: 'image/jpeg',
        };

        const imageResult = await this.storageService.uploadImageFromUrl(
          details.imageUrl,
          auction.code,
        );
        if (imageResult) {
          imageFile.storageKey = imageResult.key;
          imageFile.publicUrl = imageResult.url;
          imageFile.size = imageResult.size;
          imageFile.uploadedAt = this.clock.now();
          this.logger.debug(`Uploaded image to R2 for auction ${auction.code}: ${imageResult.key}`);
        }

        updateData.image = imageFile;
      }

      if (details.matriculaUrl && !auction.matricula?.publicUrl) {
        const result = await this.storageService.uploadDocumentFromUrl(
          details.matriculaUrl,
          auction.code,
          'matricula',
        );
        if (result) {
          updateData.matricula = {
            originalUrl: details.matriculaUrl,
            storageKey: result.key,
            publicUrl: result.url,
            mimeType: 'application/pdf',
            size: result.size,
            uploadedAt: this.clock.now(),
          };
          this.logger.debug(`Uploaded matricula to R2 for auction ${auction.code}`);
        }
      }
    }

    const phases = auction.phases ?? [];
    const lastPhaseIndex = phases.length - 1;
    const lastPhase = phases[lastPhaseIndex];
    if (details.phaseDetails && lastPhase) {
      const hasPhaseDetails =
        (lastPhase.paymentMethods?.length ?? 0) > 0 ||
        (lastPhase.expenseRules?.length ?? 0) > 0 ||
        (lastPhase.phaseDates?.length ?? 0) > 0;

      if (!hasPhaseDetails) {
        // Every phase is written back, so each leaves in the new money shape (AR-17, AR-28).
        const updatedPhases: StoredPhase[] = phases.map(restorePhase);
        const updatedLastPhase: StoredPhase = {
          ...restorePhase(lastPhase),
          paymentMethods: details.phaseDetails.paymentMethods,
          expenseRules: details.phaseDetails.expenseRules,
          phaseDates: details.phaseDetails.phaseDates,
        };
        updatedPhases[lastPhaseIndex] = updatedLastPhase;
        updateData.phases = updatedPhases;
        updateData.currentPhase = updatedLastPhase;
        this.logger.debug(
          `Scraped phase details for auction ${auction.code}: ${details.phaseDetails.paymentMethods?.length || 0} payment methods, ${details.phaseDetails.expenseRules?.length || 0} expense rules, ${details.phaseDetails.phaseDates?.length || 0} phase dates`,
        );
      }
    }

    await this.auctionModel.updateOne({ code: auction.code }, { $set: updateData });
    this.logger.log(`Auction ${auction.code} scraped successfully`);
    return true;
  }

  /**
   * Helper method to add delay between requests
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
