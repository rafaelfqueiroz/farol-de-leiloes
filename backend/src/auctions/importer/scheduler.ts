import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { captureException } from '@sentry/nestjs';
import { AuctionsService } from '../auctions.service.js';
import { normalizeRows, listFacts, parseCaixaList, type ParsedList } from './parser.js';
import { toListRows } from './list-rows.js';
import { ListApplier } from './list-applier.service.js';
import { validateList, type ListVerdict } from '../domain/list-validator.js';
import { ImportRunService } from '../import-runs/import-run.service.js';
import { Clock } from '../../common/clock/clock.js';
import businessConfig, { type BusinessConfig } from '../../config/business.config.js';
import { JobExecutionService } from '../../common/services/job-execution.service.js';
import { RunMode } from '../../common/job-execution.js';
import { CsvCacheService } from './csv-cache.service.js';
import schedulerConfig, { SchedulerConfig } from '../../config/scheduler.config.js';
import { BRASILIA_TIME_ZONE, brasiliaToday } from '../../common/clock/brasilia-time.js';
import { InJobContext, runInJobContext } from '../../common/observability/job-context.js';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import { AUCTIONS_IMPORT_JOB } from './import-job.js';

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
    private readonly importRuns: ImportRunService,
    private readonly applier: ListApplier,
    private readonly clock: Clock, // AR-24
    @Inject(businessConfig.KEY) private readonly business: BusinessConfig,
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

    // The Import Run of today (a SUCCESS one makes runImport stop before it downloads) replaces
    // the old "ran within 23 hours" guard of jobexecutions (SPEC-004 BR-004-07).
    await this.runImport(RunMode.AUTO);
  }

  /**
   * SPEC-004 part 2, single attempt: download, parse, validate against the last applied list,
   * apply, record the Import Run of the Brasília day (BR-004-27). A list that is rejected, or not
   * newer than the last applied one, is recorded and applies NOTHING (BR-004-10); a failure is
   * recorded with a stable code, never the message (SC-15). The window, cutoff, retries and alerts
   * of the run are part 3.
   *
   * Only the download, the validation and the apply are the run: once the Import Run says SUCCESS
   * nothing after it can make the run or the health report fail (afterSuccess is best-effort).
   */
  private async runImport(runMode: RunMode) {
    this.logger.log(`Starting auctions import (${runMode} mode)`);
    const today = brasiliaToday(this.clock); // AR-23, AR-24
    let runId: string | null = null;
    try {
      if ((await this.importRuns.findByDate(today))?.outcome === 'SUCCESS') {
        this.logger.log('Today is already imported (an Import Run succeeded); nothing to do');
        return;
      }

      const csv = await this.csvCacheService.resolveCsv();
      const list = parseCaixaList(csv);
      const facts = listFacts(list);
      const verdict = validateList(
        facts,
        await this.importRuns.lastAppliedList(),
        this.business.import.minRowRatio,
        today,
      );
      if (verdict.kind !== 'valid') {
        await this.recordNotApplied(runMode, today, list, facts.usableCodeCount, verdict);
        return;
      }
      // A valid verdict has a generation date (validateList rejects a list without one).
      const generatedOn = list.generatedOn ?? today;

      // The row count of a list is its DISTINCT usable property numbers: what the next list is
      // compared with (BR-004-04).
      const run = await this.importRuns.begin(today, { generatedOn, rows: facts.usableCodeCount });
      if (run === null) {
        this.logger.log('Today is already imported (an Import Run succeeded); nothing to do');
        return;
      }
      runId = run.id;

      const { rows, withoutCode, unknownModality, offSiteLinks } = toListRows(
        normalizeRows(list.rows),
      );
      this.logger.log(
        `List rows: ${list.rows.length}, without a property number: ${withoutCode}, unknown modality: ${unknownModality}, links off Caixa's site: ${offSiteLinks}`,
      );
      const counts = await this.applier.apply({
        runId,
        rows,
        minRowRatio: this.business.import.minRowRatio,
      });
      if (!(await this.importRuns.markSuccess(runId, counts))) {
        // Another attempt of the day finished it first. Applying is idempotent: nothing is lost.
        this.logger.log('The Import Run was already finished by another attempt');
      }
    } catch (e) {
      // SC-15: the stable code, never the message (it may quote a URL or a value).
      this.logger.error(`Failed import: ${jobErrorCode(e)}`);
      // AR-47: cron and startup runs alike; the scrubber drops the message from the event.
      captureException(e, { tags: { jobName: this.jobName } });
      await this.recordFailure(runMode, e, today, runId);
      throw e;
    }
    await this.afterSuccess(runMode);
  }

  /**
   * After the Import Run is SUCCESS: refresh the neighborhoods cache and record the run for the
   * health report (AR-48). Best-effort and outside the failure path: a throw here is logged by its
   * code and must never turn a run that applied the list into a failed one.
   */
  private async afterSuccess(runMode: RunMode): Promise<void> {
    try {
      await this.auctions.invalidateNeighborhoodsCache();
      this.logger.log('Neighborhoods cache invalidated');
    } catch (error) {
      this.logger.warn(`Could not invalidate the neighborhoods cache: ${jobErrorCode(error)}`);
    }
    try {
      await this.jobExecutionService.recordExecution(this.jobName, runMode);
      this.logger.log('Auctions import completed (run recorded)');
    } catch (error) {
      this.logger.error(`Could not record the successful import: ${jobErrorCode(error)}`);
    }
  }

  /** BR-004-10: the list is not applied; the day's run says why, by code (SC-15). */
  private async recordNotApplied(
    runMode: RunMode,
    today: string,
    list: ParsedList,
    usableRows: number,
    verdict: Exclude<ListVerdict, { kind: 'valid' }>,
  ): Promise<void> {
    const rejected = verdict.kind === 'rejected';
    const code = rejected ? verdict.reason : 'NO_NEW_LIST';
    await this.importRuns.recordWithoutApply(
      today,
      rejected ? 'REJECTED_LIST' : 'NO_NEW_LIST',
      code,
      { generatedOn: list.generatedOn, rows: usableRows },
    );
    this.logger.warn(`List not applied: ${rejected ? 'REJECTED_LIST' : 'NO_NEW_LIST'} ${code}`);
    await this.jobExecutionService.recordFailure(
      this.jobName,
      runMode,
      rejected ? 'LIST_REJECTED' : 'NO_NEW_LIST',
    );
  }

  /** AR-03: a failed run is recorded too (GET /api/health reports it, AR-48). */
  private async recordFailure(
    runMode: RunMode,
    error: unknown,
    today: string,
    runId: string | null,
  ): Promise<void> {
    const code = jobErrorCode(error);
    try {
      try {
        if (runId !== null) await this.importRuns.markFailed(runId, code);
        else await this.importRuns.recordWithoutApply(today, 'FAILED', code);
      } finally {
        // The health report reads this one, whatever happened to the Import Run row.
        await this.jobExecutionService.recordFailure(this.jobName, runMode, code);
      }
    } catch (recordError) {
      // The original failure is what the caller must see; this one is only logged.
      this.logger.error(`Could not record the failed import: ${jobErrorCode(recordError)}`);
    }
  }
}
