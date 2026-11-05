import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { captureException } from '@sentry/nestjs';
import { AuctionsService } from '../auctions.service';
import { normalizeRows, parseCsv } from './parser';
import { PhaseModality } from '../schemas/auction.schema';
import type { Phase } from '../interfaces/auction.interface';
import { JobExecutionService } from '../../common/services/job-execution.service';
import { RunMode } from '../../common/schemas/job-execution.schema';
import { CsvCacheService } from './csv-cache.service';
import schedulerConfig, { SchedulerConfig } from '../../config/scheduler.config';
import { BRASILIA_TIME_ZONE } from '../../common/clock/brasilia-time';
import { InJobContext, runInJobContext } from '../../common/observability/job-context';
import { jobErrorCode } from '../../common/services/job-error-code';
import { AUCTIONS_IMPORT_JOB } from './import-job';

/** Delay of the optional startup import (IMPORT_ON_START_UP), so boot finishes first. */
export const STARTUP_IMPORT_DELAY_MS = 5000;

@Injectable()
export class AuctionsImporter {
  private readonly logger = new Logger(AuctionsImporter.name);
  private readonly jobName = AUCTIONS_IMPORT_JOB;

  constructor(
    private readonly auctions: AuctionsService,
    private readonly jobExecutionService: JobExecutionService,
    private readonly csvCacheService: CsvCacheService,
    @Inject(schedulerConfig.KEY)
    private readonly config: SchedulerConfig,
  ) {}

  // Run on startup only if IMPORT_ON_START_UP=true
  async onModuleInit() {
    const { enabled, onStartup } = this.config.import;

    if (!enabled) {
      this.logger.log('Import is disabled (IMPORT_ENABLED=false)');
      return;
    }

    if (onStartup) {
      this.logger.log('Running import on startup (IMPORT_ON_START_UP=true)');
      // AR-46: its own job context. The failure is already logged and recorded by runImport; the
      // catch keeps it from becoming an unhandled rejection, which would crash the process.
      setTimeout(() => {
        runInJobContext(this.jobName, () => this.runImport(RunMode.MANUAL)).catch(() => {
          this.logger.warn('Startup import failed; the daily schedule will run it again');
        });
      }, STARTUP_IMPORT_DELAY_MS);
    } else {
      this.logger.log(
        'Skipping startup import (IMPORT_ON_START_UP=false), will run on schedule only',
      );
    }
  }

  // AR-25 / BR-003-27: 03:00 in Brasília, whatever zone the server runs in.
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: BRASILIA_TIME_ZONE })
  @InJobContext(AUCTIONS_IMPORT_JOB) // AR-46
  async dailyJob() {
    const { enabled } = this.config.import;

    if (!enabled) {
      this.logger.log('Import is disabled (IMPORT_ENABLED=false), skipping scheduled job');
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

    await this.runImport(RunMode.AUTO);
  }

  private async runImport(runMode: RunMode) {
    this.logger.log(`Starting auctions import (${runMode} mode)`);
    try {
      const csv = await this.csvCacheService.resolveCsv();
      const parsed = parseCsv(csv);
      const normalizedRows = normalizeRows(parsed);
      this.logger.log(`Normalized rows: ${normalizedRows.length}`);

      const skippedNoModality = 0;
      let skippedUnknownModality = 0;

      const normalized = normalizedRows.map((n) => {
        const phases: Phase[] = [];

        // Convert modality to phase
        if (n.modality) {
          const phaseModality = this.mapModalityToPhase(n.modality);
          if (phaseModality) {
            phases.push({
              modality: phaseModality,
              minimumPrice: n.minimumPrice ?? null,
              phaseDates: [], // Dates are scraped from the details page
            });
          } else {
            skippedUnknownModality++;
            this.logger.debug(`Unknown modality: "${n.modality}" for code: ${n.code}`);
          }
        }

        return {
          code: n.code,
          title: n.title,
          address: {
            street: n.street,
            neighborhood: n.neighborhood,
            city: n.city,
            state: n.state,
          },
          appraisalPrice: n.appraisalPrice ?? undefined,
          phases,
          detailsUrl: n.detailsUrl ?? undefined,
        };
      });

      this.logger.log(`Prepared ${normalized.length} items for upsert`);
      this.logger.log(`Items without modality: ${skippedNoModality}`);
      this.logger.log(`Items with unknown modality: ${skippedUnknownModality}`);

      const withPhases = normalized.filter((n) => n.phases.length > 0);
      const withoutPhases = normalized.filter((n) => n.phases.length === 0);
      this.logger.log(
        `Items with phases: ${withPhases.length}, without phases: ${withoutPhases.length}`,
      );

      const res = await this.auctions.upsertMany(normalized);
      this.logger.log(
        `Import result - matched: ${res.matched}, upserted: ${res.upserted}, modified: ${res.modified}`,
      );
      this.logger.log(`Auctions import completed.`);

      // Auctions present in the CSV are available again (e.g. previously marked unavailable)
      const csvCodes = normalized.map((n) => n.code).filter(Boolean) as string[];
      if (csvCodes.length > 0) {
        const markedAvailable = await this.auctions.markAvailable(csvCodes);
        this.logger.log(`Availability restore - marked available: ${markedAvailable}`);
      }

      // Verify availability of auctions not present in the CSV
      if (csvCodes.length > 0) {
        const availabilityResult = await this.auctions.verifyAvailability(csvCodes);
        this.logger.log(
          `Availability check - checked: ${availabilityResult.checked}, unavailable: ${availabilityResult.unavailable}, errors: ${availabilityResult.errors}`,
        );
      } else {
        this.logger.warn('Skipping availability check — CSV returned no auction codes');
      }

      // Invalidate neighborhoods cache after import
      await this.auctions.invalidateNeighborhoodsCache();
      this.logger.log(`Neighborhoods cache invalidated`);

      // Record execution in database
      await this.jobExecutionService.recordExecution(this.jobName, runMode);
      this.logger.log(`Execution recorded in database`);
    } catch (e) {
      // SC-15: the stable code, never the message (it may quote a URL or a value).
      this.logger.error(`Failed import: ${jobErrorCode(e)}`);
      // AR-47: cron and startup runs alike; the scrubber drops the message from the event.
      captureException(e, { tags: { jobName: this.jobName } });
      await this.recordFailure(runMode, e);
      throw e;
    }
  }

  /** AR-03: a failed run is recorded too (GET /api/health reports it, AR-48). */
  private async recordFailure(runMode: RunMode, error: unknown): Promise<void> {
    try {
      await this.jobExecutionService.recordFailure(this.jobName, runMode, jobErrorCode(error));
    } catch (recordError) {
      // The original failure is what the caller must see; this one is only logged.
      this.logger.error(`Could not record the failed import: ${jobErrorCode(recordError)}`);
    }
  }

  private mapModalityToPhase(modality: string): PhaseModality | null {
    const normalized = modality.toUpperCase();
    if (
      normalized.includes('SFI') ||
      normalized.includes('EDITAL ÚNICO') ||
      normalized.includes('EDITAL UNICO') ||
      normalized.includes('LEILÃO') ||
      normalized.includes('LEILAO')
    )
      return PhaseModality.SFI_AUCTION;
    if (normalized.includes('LICITACAO') || normalized.includes('LICITAÇÃO'))
      return PhaseModality.OPEN_BIDDING;
    if (normalized.includes('VENDA DIRETA') || normalized.includes('VENDA DIRETA ONLINE'))
      return PhaseModality.DIRECT_ONLINE_SALES;
    if (normalized.includes('VENDA ONLINE')) return PhaseModality.ONLINE_SALES;
    return null;
  }
}
