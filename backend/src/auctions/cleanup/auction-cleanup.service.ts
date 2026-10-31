import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuctionEntity, AuctionDocument } from '../schemas/auction.schema';
import { StorageService } from '../../storage/storage.service';
import schedulerConfig, { SchedulerConfig } from '../../config/scheduler.config';

const CLEANUP_THRESHOLD_DAYS = 14;

@Injectable()
export class AuctionCleanupService implements OnModuleInit {
  private readonly logger = new Logger(AuctionCleanupService.name);
  private readonly batchSize = 15;
  private readonly concurrency = 3;
  private readonly delayBetweenGroups = 500;

  constructor(
    @InjectModel(AuctionEntity.name) private readonly auctionModel: Model<AuctionDocument>,
    private readonly storageService: StorageService,
    @Inject(schedulerConfig.KEY)
    private readonly config: SchedulerConfig,
  ) {}

  async onModuleInit() {
    const { onStartup } = this.config.cleanup;

    if (onStartup) {
      this.logger.log('Running cleanup on startup (CLEANUP_ON_STARTUP=true)');
      setTimeout(() => this.runCleanup(), 10000);
    } else {
      this.logger.log('Cleanup disabled (CLEANUP_ON_STARTUP=false)');
    }
  }

  private async runCleanup() {
    this.logger.log('Starting unavailable auctions cleanup');

    try {
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - CLEANUP_THRESHOLD_DAYS);

      const auctions = await this.auctionModel
        .find({
          available: false,
          updatedAt: { $lte: thresholdDate },
          $or: [
            { image: { $exists: true } },
            { matricula: { $exists: true } },
          ],
        })
        .lean();

      this.logger.log(`Found ${auctions.length} unavailable auctions older than ${CLEANUP_THRESHOLD_DAYS} days`);

      if (auctions.length === 0) {
        this.logger.log('No auctions to clean up');
        return;
      }

      let deletedCount = 0;
      let retainedCount = 0;
      let filesDeleted = 0;
      let errorCount = 0;

      for (let i = 0; i < auctions.length; i += this.batchSize) {
        const batch = auctions.slice(i, i + this.batchSize);
        this.logger.log(`Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(auctions.length / this.batchSize)}`);

        for (let j = 0; j < batch.length; j += this.concurrency) {
          const group = batch.slice(j, j + this.concurrency);
          const results = await Promise.allSettled(
            group.map(auction => this.processAuction(auction)),
          );

          for (let k = 0; k < results.length; k++) {
            const result = results[k];
            if (result.status === 'fulfilled') {
              filesDeleted += result.value.filesDeleted;
              if (result.value.removed) {
                deletedCount++;
              } else {
                retainedCount++;
              }
            } else {
              errorCount++;
              this.logger.error(`Error cleaning auction ${group[k].code}: ${result.reason?.message || result.reason}`);
            }
          }

          await this.delay(this.delayBetweenGroups);
        }
      }

      this.logger.log(`Cleanup completed: ${deletedCount} auctions removed, ${filesDeleted} files deleted, ${retainedCount} retained for retry, ${errorCount} errors`);
    } catch (error: any) {
      this.logger.error(`Cleanup failed: ${error?.message || error}`);
    }
  }

  private async processAuction(
    auction: AuctionEntity & { _id: unknown },
  ): Promise<{ removed: boolean; filesDeleted: number }> {
    let filesDeleted = 0;

    const storageKeys = [
      auction.image?.storageKey,
      auction.matricula?.storageKey,
      auction.edital?.storageKey,
    ].filter(Boolean) as string[];

    if (storageKeys.length > 0) {
      if (!this.storageService.isConfigured()) {
        this.logger.warn(`Keeping auction ${auction.code}: storage not configured, files cannot be deleted`);
        return { removed: false, filesDeleted };
      }

      let allFilesDeleted = true;
      for (const key of storageKeys) {
        const deleted = await this.storageService.deleteFile(key);
        if (deleted) {
          filesDeleted++;
        } else {
          allFilesDeleted = false;
        }
      }

      // Keep the document (and its storage keys) so the next run retries the failed deletions
      if (!allFilesDeleted) {
        this.logger.warn(`Keeping auction ${auction.code}: some files could not be deleted, will retry on next cleanup`);
        return { removed: false, filesDeleted };
      }
    }

    await this.auctionModel.deleteOne({ _id: auction._id });
    this.logger.debug(`Deleted auction ${auction.code} (${filesDeleted} files removed)`);

    return { removed: true, filesDeleted };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
