import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InJobContext, runInJobContext } from '../../common/observability/job-context.js';
import { BRASILIA_TIME_ZONE } from '../../common/clock/brasilia-time.js';
import schedulerConfig, { SchedulerConfig } from '../../config/scheduler.config.js';
import { AUCTIONS_IMPORT_JOB } from './import-job.js';
import { ImportOrchestrator } from './import-orchestrator.service.js';

/** Delay of the optional startup import (IMPORT_ON_START_UP), so boot finishes first. */
export const STARTUP_IMPORT_DELAY_MS = 5000;

/**
 * The job class of the Caixa import: the schedule and nothing else (AR-04). Every five minutes it
 * asks `ImportOrchestrator.tick()` what the day's Import Run needs, and the orchestrator decides
 * from the persisted state (window, spacing, attempts, cutoff, lease: SPEC-004 BR-004-01..04).
 * That tick is idempotent, so a restart, a second process or an overlapping tick is harmless.
 *
 * `ImportOrchestrator` is a plain service (nothing in it schedules), so the E2E stack replaces only
 * this class to keep the import inert (test/e2e-stack/main.ts).
 */
@Injectable()
export class AuctionsImporter {
  private readonly logger = new Logger(AuctionsImporter.name);

  constructor(
    private readonly orchestrator: ImportOrchestrator,
    @Inject(schedulerConfig.KEY) private readonly config: SchedulerConfig,
  ) {}

  // IMPORT_ON_START_UP=true: one attempt a few seconds after boot, outside the window (development).
  onModuleInit() {
    const { enabled, onStartup } = this.config.import;

    if (!enabled) {
      this.logger.log('Import is disabled (IMPORT_ENABLED=false)');
      return;
    }

    if (onStartup) {
      this.logger.log('Running one import attempt on startup (IMPORT_ON_START_UP=true)');
      // AR-46: its own job context. tick() never rejects; the catch keeps even a surprise from
      // becoming an unhandled rejection, which would crash the process.
      setTimeout(() => {
        runInJobContext(AUCTIONS_IMPORT_JOB, () => this.orchestrator.tick({ force: true })).catch(
          () => {
            this.logger.warn('Startup import failed; the schedule will run it again');
          },
        );
      }, STARTUP_IMPORT_DELAY_MS);
    } else {
      this.logger.log(
        'Skipping startup import (IMPORT_ON_START_UP=false), will run on schedule only',
      );
    }
  }

  // AR-25 / BR-003-27: every five minutes in Brasília, whatever zone the server runs in. The tick
  // does nothing outside the day's window.
  @Cron(CronExpression.EVERY_5_MINUTES, { timeZone: BRASILIA_TIME_ZONE })
  @InJobContext(AUCTIONS_IMPORT_JOB) // AR-46
  async tick() {
    if (!this.config.import.enabled) {
      this.logger.debug('Import is disabled (IMPORT_ENABLED=false), skipping tick');
      return;
    }
    await this.orchestrator.tick();
  }
}
