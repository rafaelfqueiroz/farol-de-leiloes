import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuctionsService } from '../auctions.service';
import { downloadCsvAllStates } from './downloader';
import { normalizeRows, parseCsv } from './parser';
import { PhaseModality, Phase } from '../schemas/auction.schema';
import { JobExecutionService } from '../../common/services/job-execution.service';
import { RunMode } from '../../common/schemas/job-execution.schema';
import schedulerConfig, { SchedulerConfig } from '../../config/scheduler.config';

@Injectable()
export class AuctionsImporter {
  private readonly logger = new Logger(AuctionsImporter.name);
  private readonly jobName = 'auctions-import';

  constructor(
    private readonly auctions: AuctionsService,
    private readonly jobExecutionService: JobExecutionService,
    @Inject(schedulerConfig.KEY)
    private readonly config: SchedulerConfig,
  ) {}

  // Run on startup only if IMPORT_RUN_MODE=MANUAL
  async onModuleInit() {
    const { enabled, runMode } = this.config.import;

    if (!enabled) {
      this.logger.log('Import is disabled (IMPORT_ENABLED=false)');
      return;
    }

    if (runMode === 'MANUAL') {
      this.logger.log('MANUAL mode: Running import on startup');
      setTimeout(() => this.runImport(RunMode.MANUAL), 5000);
    } else {
      this.logger.log('AUTO mode: Skipping startup import (scheduled only)');
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async dailyJob() {
    const { enabled, runMode } = this.config.import;

    if (!enabled) {
      this.logger.log('Import is disabled (IMPORT_ENABLED=false), skipping scheduled job');
      return;
    }

    if (runMode !== 'AUTO') {
      this.logger.log('MANUAL mode: Skipping scheduled job (run on startup only)');
      return;
    }

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
      const csv = await downloadCsvAllStates();
      const parsed = parseCsv(csv);
      const normalized = normalizeRows(parsed).map((n) => {
        const phases: Phase[] = [];

        // Convert modality to phase
        if (n.modality) {
          const phaseModality = this.mapModalityToPhase(n.modality);
          if (phaseModality) {
            phases.push({
              modality: phaseModality,
              minimumPrice: n.minimumPrice ?? null,
              date: null, // CSV doesn't contain auction dates
            });
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
      const res = await this.auctions.upsertMany(normalized);
      this.logger.log(`Imported ${normalized.length} rows (upserts: ${res.upserted})`);
      this.logger.log(`Auctions import completed.`);
      
      // Record execution in database
      await this.jobExecutionService.recordExecution(this.jobName, runMode);
      this.logger.log(`Execution recorded in database`);
    } catch (e: any) {
      this.logger.error(`Failed import: ${e?.message || e}`);
      throw e;
    }
  }

  private mapModalityToPhase(modality: string): PhaseModality | null {
    const normalized = modality.toUpperCase();
    if (normalized.includes('1') || normalized.includes('PRIMEIRO')) return PhaseModality.FIRST_AUCTION;
    if (normalized.includes('2') || normalized.includes('SEGUNDO')) return PhaseModality.SECOND_AUCTION;
    if (normalized.includes('LICITACAO') || normalized.includes('LICITAÇÃO')) return PhaseModality.OPEN_BIDDING;
    if (normalized.includes('COMPRA DIRETA ONLINE')) return PhaseModality.DIRECT_ONLINE_SALES;
    if (normalized.includes('VENDA ONLINE') || normalized.includes('ONLINE')) return PhaseModality.ONLINE_SALES;
    if (normalized.includes('COMPRA DIRETA')) return PhaseModality.DIRECT_ONLINE_SALES;
    return null;
  }
}
