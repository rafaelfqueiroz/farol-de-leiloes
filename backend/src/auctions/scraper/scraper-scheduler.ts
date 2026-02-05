import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuctionEntity, AuctionDocument, Phase } from '../schemas/auction.schema';
import { fetchAndScrapeDetails } from './details-scraper';
import { JobExecutionService } from '../../common/services/job-execution.service';
import { RunMode } from '../../common/schemas/job-execution.schema';
import schedulerConfig, { SchedulerConfig } from '../../config/scheduler.config';

@Injectable()
export class AuctionDetailsScraper implements OnModuleInit {
  private readonly logger = new Logger(AuctionDetailsScraper.name);
  private readonly jobName = 'auction-details-scraper';
  private readonly batchSize = 10; // Process 10 auctions at a time
  private readonly delayBetweenRequests = 2000; // 2 seconds delay between requests

  constructor(
    @InjectModel(AuctionEntity.name) private readonly auctionModel: Model<AuctionDocument>,
    private readonly jobExecutionService: JobExecutionService,
    @Inject(schedulerConfig.KEY)
    private readonly config: SchedulerConfig,
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

    this.logger.log('Auction details scraper initialized. Scheduled to run daily at 6 AM BRT (9 AM UTC)');

    if (onStartup) {
      this.logger.log('Running scraper on startup (SCRAPER_ON_START_UP=true)');
      setTimeout(() => this.runScraper(RunMode.MANUAL), 5000);
    } else {
      this.logger.log('Skipping startup scraper (SCRAPER_ON_START_UP=false), will run on schedule only');
    }
  }

  /**
   * Runs daily at 6 AM BRT (which is UTC-3)
   * Cron runs in UTC, so 6 AM BRT = 9 AM UTC
   */
  @Cron('0 9 * * *')
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
    } catch (e: any) {
      this.logger.error(`Failed scraping: ${e?.message || e}`);
      throw e;
    }
  }

  /**
   * Main scraping logic - finds auctions that are not fulfilled yet
   * and scrapes their details
   */
  private async scrapeAuctionDetails() {
    try {
      // Find auctions where fulfilled = false or doesn't exist
      const auctionsToScrape = await this.auctionModel
        .find({
          $or: [
            { fulfilled: { $exists: false } },
            { fulfilled: false }
          ]
        })
        .lean();

      this.logger.log(`Found ${auctionsToScrape.length} unfulfilled auctions to scrape`);

      if (auctionsToScrape.length === 0) {
        this.logger.log('No auctions to scrape');
        return;
      }

      let scrapedCount = 0;
      let errorCount = 0;

      // Process in batches to avoid overwhelming the server
      for (let i = 0; i < auctionsToScrape.length; i += this.batchSize) {
        const batch = auctionsToScrape.slice(i, i + this.batchSize);

        this.logger.log(`Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(auctionsToScrape.length / this.batchSize)}`);

        for (const auction of batch) {
          try {
            if (!auction.detailsUrl) continue;

            // Scrape details
            const details = await fetchAndScrapeDetails(auction.detailsUrl);

            // If the property is no longer available, mark it and skip further processing
            if (details.unavailable) {
              await this.auctionModel.updateOne(
                { code: auction.code },
                { $set: { available: false, fulfilled: true, updatedAt: new Date() } }
              );
              this.logger.log(`Auction ${auction.code} marked as unavailable`);
              scrapedCount++;
              await this.delay(this.delayBetweenRequests);
              continue;
            }

            // Update auction with scraped details and mark as fulfilled
            const updateData: Record<string, unknown> = {
              fulfilled: true,
              updatedAt: new Date()
            };

            if (details.imageUrl) {
              updateData.imageUrl = details.imageUrl;
              this.logger.debug(`Scraped image for auction ${auction.code}: ${details.imageUrl}`);
            }

            if (details.description) {
              updateData.description = details.description;
              this.logger.debug(`Scraped description for auction ${auction.code}`);
            }

            // Update phase-specific details (paymentMethods, expenseRules, phaseDates) on the last phase
            if (details.phaseDetails && auction.phases && auction.phases.length > 0) {
              const updatedPhases: Phase[] = [...auction.phases];
              const lastPhaseIndex = updatedPhases.length - 1;
              updatedPhases[lastPhaseIndex] = {
                ...updatedPhases[lastPhaseIndex],
                paymentMethods: details.phaseDetails.paymentMethods,
                expenseRules: details.phaseDetails.expenseRules,
                phaseDates: details.phaseDetails.phaseDates,
              };
              updateData.phases = updatedPhases;
              this.logger.debug(`Scraped phase details for auction ${auction.code}: ${details.phaseDetails.paymentMethods?.length || 0} payment methods, ${details.phaseDetails.expenseRules?.length || 0} expense rules, ${details.phaseDetails.phaseDates?.length || 0} phase dates`);
            }

            await this.auctionModel.updateOne(
              { code: auction.code },
              { $set: updateData }
            );
            scrapedCount++;

            // Delay between requests to be respectful to the server
            await this.delay(this.delayBetweenRequests);
          } catch (error: any) {
            errorCount++;
            this.logger.error(`Error scraping auction ${auction.code}: ${error?.message || error}`);
          }
        }
      }

      this.logger.log(`Scraping completed: ${scrapedCount} images scraped, ${errorCount} errors`);
    } catch (error: any) {
      this.logger.error(`Failed to scrape auction details: ${error?.message || error}`);
      throw error;
    }
  }

  /**
   * Helper method to add delay between requests
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
