import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { AuctionsService } from '../auctions.service.js';
import { CaixaBlockedError, CaixaUnreachableError } from '../caixa/caixa-access.js';
import { Clock } from '../../common/clock/clock.js';
import { brasiliaToday } from '../../common/clock/brasilia-time.js';
import { RunMode } from '../../common/job-execution.js';
import { BusinessCalendar } from '../../common/services/business-calendar.service.js';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import { JobExecutionService } from '../../common/services/job-execution.service.js';
import businessConfig, { type BusinessConfig } from '../../config/business.config.js';
import {
  type ImportDecision,
  type ImportSchedule,
  decideNextAction,
  isSameRejectedFile,
  LIST_BLOCKED,
  nextAttemptDue,
  type RunState,
} from '../domain/import-schedule.js';
import { validateList } from '../domain/list-validator.js';
import { EnrichmentPass, type CollectionResult } from '../enrichment/enrichment-pass.js';
import { DailyUpdateBus } from '../import-runs/daily-update-bus.js';
import { ImportAlertService } from '../import-runs/import-alert.service.js';
import type { ImportCounts, ImportRunRecord } from '../import-runs/import-run.js';
import { RUN_LEASE_MS, ImportRunService } from '../import-runs/import-run.service.js';
import { CsvCacheService } from './csv-cache.service.js';
import { AUCTIONS_IMPORT_JOB } from './import-job.js';
import { ListApplier } from './list-applier.service.js';
import { toListRows } from './list-rows.js';
import { listFacts, normalizeRows, parseCaixaList } from './parser.js';

/** How often the holder of a run extends its lease while it works. */
export const LEASE_RENEW_MS = RUN_LEASE_MS / 3;

/** The most steps one tick takes on a run: an attempt, then the finish of what it led to. */
const MAX_STEPS = 4;

export interface TickOptions {
  /**
   * One attempt now whatever the window, the spacing or the cutoff say (the development startup
   * import, IMPORT_ON_START_UP). It is still one request, still under the lease, still recorded;
   * it never overrides a run that is already decided.
   */
  force?: boolean;
}

/** The worker lost the lease (it stalled past its expiry): it stops, the new holder carries on. */
class LeaseLostError extends Error {
  override name = 'LeaseLostError';
}

/**
 * SPEC-004 BR-004-01..04, BR-004-10, BR-004-23, BR-004-29: the daily import as a tick-driven,
 * restart-safe state machine. `tick()` is idempotent: it decides what to do from the persisted
 * Import Runs and the clock alone (`decideNextAction`, pure), so a process that restarts, two
 * processes, or a tick that overlaps the previous one cannot do the day's work twice:
 *
 *  - the run of the day is created once (unique `brasiliaDate`) and kept across midnight;
 *  - whoever works a run holds its LEASE, an atomic conditional update; a tick that cannot get it
 *    returns quietly, and a lease that expires (a killed process) is taken over by the next tick,
 *    which resumes the apply (idempotent, DL-004-04) or the collection pass (idempotent);
 *  - every write of the worker is fenced on the lease, so a stalled worker cannot overwrite the
 *    one that took over.
 *
 * Caixa is reached only through `CsvCacheService` and the `CaixaAccess` port, one request per
 * attempt, spaced and bounded. A block ends the day at once (BR-004-20): never retried harder.
 * A tick never rejects: its failures are logged by code (SC-15) and reported to Sentry.
 */
@Injectable()
export class ImportOrchestrator {
  private readonly logger = new Logger(ImportOrchestrator.name);
  private readonly schedule: ImportSchedule;
  /** How often a worker extends its lease; a spec shortens it to watch the heartbeat. */
  leaseRenewMs = LEASE_RENEW_MS;

  constructor(
    private readonly runs: ImportRunService,
    private readonly csvCache: CsvCacheService,
    private readonly applier: ListApplier,
    private readonly calendar: BusinessCalendar,
    private readonly clock: Clock, // AR-24
    @Inject(businessConfig.KEY) private readonly business: BusinessConfig,
    private readonly auctions: AuctionsService,
    private readonly jobExecutions: JobExecutionService,
    private readonly enrichment: EnrichmentPass,
    private readonly bus: DailyUpdateBus,
    private readonly alerts: ImportAlertService,
  ) {
    const { windowStartMinutes, cutoffMinutes, maxAttempts, attemptSpacingMinutes } =
      business.import;
    this.schedule = { windowStartMinutes, cutoffMinutes, maxAttempts, attemptSpacingMinutes };
  }

  async tick(options: TickOptions = {}): Promise<void> {
    const runMode = options.force === true ? RunMode.MANUAL : RunMode.AUTO;
    try {
      const today = brasiliaToday(this.clock); // AR-23, AR-24
      // An unfinished run of an earlier day keeps its own date, window and cutoff: it is looked
      // at first, then today's.
      const open = await this.runs.findOpen();
      const days = [...new Set([...open.map((run) => run.brasiliaDate), today])].sort();
      for (const day of days) {
        await this.processDay(day, runMode, options.force === true && day === today);
      }
    } catch (error) {
      this.reportFault('The import tick failed', error);
    }
    // Alerts that still owe an email (a released claim, a process that died after deciding).
    await this.alerts.retryPending();
  }

  private async processDay(day: string, runMode: RunMode, force: boolean): Promise<void> {
    const existing = await this.runs.findByDate(day);
    if (this.decide(day, existing, force).kind === 'wait') return;

    const run = existing ?? (await this.runs.ensure(day));
    const owner = randomUUID(); // one holder per tick: two ticks of one process never share a lease
    const leased = await this.runs.acquireLease(run.id, owner);
    if (leased === null) {
      this.logger.debug(`The run of ${day} is being worked by another holder`);
      return;
    }
    const stopHeartbeat = this.keepLease(leased.id, owner);
    try {
      await this.work(leased, owner, runMode, force);
    } catch (error) {
      if (error instanceof LeaseLostError) {
        this.logger.warn(
          `The lease of the run of ${day} was lost: stopping, the new holder carries on`,
        );
      } else {
        this.reportFault(`The run of ${day} failed`, error);
      }
    } finally {
      stopHeartbeat();
      await this.runs.releaseLease(leased.id, owner).catch((error: unknown) => {
        this.logger.warn(`Could not release a lease: ${jobErrorCode(error)}`);
      });
    }
  }

  /**
   * Under the lease: decide again (the state may have moved since the unfenced read), do one step,
   * and follow what it led to: an applied list goes on to its collection pass and its completion
   * in the same tick.
   */
  private async work(
    leased: ImportRunRecord,
    owner: string,
    runMode: RunMode,
    force: boolean,
  ): Promise<void> {
    let current = leased;
    let forced = force;
    for (let step = 0; step < MAX_STEPS; step++) {
      const decision = this.decide(current.brasiliaDate, current, forced);
      forced = false;
      if (decision.kind === 'wait') return;
      if (decision.kind === 'collect') {
        await this.completeDay(current, owner, runMode);
        return;
      }
      if (decision.kind === 'finalize') {
        await this.finalizeDay(current, owner, decision, runMode);
        return;
      }
      await this.attempt(current, owner, decision.mode, runMode);
      const next = await this.runs.findById(current.id);
      if (next === null) return;
      current = next;
    }
  }

  private decide(day: string, run: ImportRunRecord | null, force: boolean): ImportDecision {
    const decision = decideNextAction(
      { brasiliaDate: day, run: run === null ? null : toState(run) },
      this.clock.now(),
      this.schedule,
      this.calendar,
    );
    const undecided = run === null || run.outcome === 'RUNNING';
    return force && undecided && decision.kind !== 'attempt'
      ? { kind: 'attempt', mode: 'search' }
      : decision;
  }

  /**
   * One attempt. A `search` makes one request to Caixa (a fresh download: the stored copy would be
   * the older list). A `resume` of a list that was being applied NEVER goes to Caixa (SC-24,
   * BR-004-07): it reads the stored copy; with none it gives the half-applied state up
   * (`applying` cleared) and falls back to a normal search in the same attempt. Whatever a resume
   * finds that is not a valid list also clears `applying`, so a run cannot be stuck resuming.
   */
  private async attempt(
    run: ImportRunRecord,
    owner: string,
    mode: 'search' | 'resume',
    runMode: RunMode,
  ) {
    const { id } = run;
    const now = this.clock.now();
    this.fence(
      await this.runs.beginAttempt(
        id,
        owner,
        nextAttemptDue(now, this.schedule.attemptSpacingMinutes),
      ),
    );
    this.logger.log(`Import attempt ${run.attempts + 1} of ${run.brasiliaDate} (${mode})`);

    let csv: string | null = null;
    if (mode === 'resume') {
      // The half-applied state is given up at once, so nothing below can leave the run "applying";
      // a valid stored list sets it again when its apply begins.
      this.fence(await this.runs.clearApplying(id, owner));
      csv = await this.csvCache.readStored();
      if (csv === null) {
        this.logger.warn('No stored copy of the list being applied: looking for a list again');
      }
    }
    if (csv === null) {
      try {
        csv = await this.csvCache.resolveCsv({ fresh: true });
      } catch (error) {
        await this.downloadFailed(run, owner, error, runMode);
        return;
      }
    }

    const list = parseCaixaList(csv);
    const facts = listFacts(list);
    const verdict = validateList(
      facts,
      await this.runs.lastAppliedList(),
      this.business.import.minRowRatio,
      brasiliaToday(this.clock),
    );

    if (verdict.kind === 'not_new') {
      // Reachable, nothing newer yet: retry at the spacing (BR-004-02). Not a failure by itself.
      this.fence(await this.runs.markListReached(id, owner));
      this.logger.log('No new list yet');
      return;
    }
    if (verdict.kind === 'rejected') {
      // BR-004-04: nothing from this file is applied. The same file again changes nothing; a newer
      // one is judged on its own.
      if (isSameRejectedFile(run.progress.rejection, facts.generatedOn)) {
        this.fence(await this.runs.markListReached(id, owner));
      } else {
        this.fence(
          await this.runs.recordRejection(id, owner, {
            generatedOn: facts.generatedOn,
            reason: verdict.reason,
            rows: facts.usableCodeCount,
          }),
        );
      }
      this.logger.warn(`List refused: ${verdict.reason}`);
      return;
    }

    // A valid verdict has a generation date (validateList rejects a list without one).
    const generatedOn = facts.generatedOn ?? brasiliaToday(this.clock);
    this.fence(await this.runs.beginApply(id, owner, { generatedOn, rows: facts.usableCodeCount }));
    await this.apply(run, owner, list);
  }

  private async apply(
    run: ImportRunRecord,
    owner: string,
    list: ReturnType<typeof parseCaixaList>,
  ): Promise<void> {
    await this.assertHeld(run.id, owner); // a stalled worker must not start a long write
    let counts: ImportCounts;
    try {
      // Everything that can throw is in here, so `applying` is never left set by an exception.
      const { rows, withoutCode, unknownModality, offSiteLinks } = toListRows(
        normalizeRows(list.rows),
      );
      this.logger.log(
        `List rows: ${list.rows.length}, without a property number: ${withoutCode}, unknown modality: ${unknownModality}, links off Caixa's site: ${offSiteLinks}`,
      );
      counts = await this.applier.apply({
        runId: run.id,
        rows,
        minRowRatio: this.business.import.minRowRatio,
      });
    } catch (error) {
      // SC-15: the class, never the message. The list stays unapplied; the next attempt tries again.
      const code = jobErrorCode(error);
      this.logger.error(`Applying the list failed: ${code}`);
      captureException(error, { tags: { jobName: AUCTIONS_IMPORT_JOB } });
      this.fence(await this.runs.markApplyFailed(run.id, owner, code));
      return;
    }
    this.fence(await this.runs.markSuccess(run.id, owner, counts));
    this.logger.log(`List applied for ${run.brasiliaDate}`);
  }

  /** A download that did not give a list: the way it failed decides what the day does next. */
  private async downloadFailed(
    run: ImportRunRecord,
    owner: string,
    error: unknown,
    runMode: RunMode,
  ) {
    if (error instanceof CaixaBlockedError) {
      // BR-004-20, SC-24: stop for the day. No retry, no other address, no waiting for a better time.
      this.logger.warn(`Caixa blocked the list request: ${error.reason}; the day ends here`);
      this.fence(await this.runs.recordFailureCode(run.id, owner, error.reason));
      captureException(error, { tags: { jobName: AUCTIONS_IMPORT_JOB } });
      await this.finalizeDay(
        run,
        owner,
        { kind: 'finalize', outcome: 'FAILED', reason: LIST_BLOCKED, nonBusinessReason: null },
        runMode,
      );
      return;
    }
    if (error instanceof CaixaUnreachableError) {
      this.logger.warn(`Caixa could not be reached: ${error.reason}`);
      this.fence(await this.runs.recordFailureCode(run.id, owner, error.reason));
      return;
    }
    // Something else broke before a list was read (the cache, the storage): counted as an attempt
    // without an answer, and reported.
    const code = jobErrorCode(error);
    this.logger.error(`The list could not be obtained: ${code}`);
    captureException(error, { tags: { jobName: AUCTIONS_IMPORT_JOB } });
    this.fence(await this.runs.recordFailureCode(run.id, owner, code));
  }

  /** The day ends without an applied list (BR-004-03, BR-004-10): recorded, health told, alert sent. */
  private async finalizeDay(
    run: ImportRunRecord,
    owner: string,
    decision: Extract<ImportDecision, { kind: 'finalize' }>,
    runMode: RunMode,
  ): Promise<void> {
    const { outcome, reason, nonBusinessReason } = decision;
    this.fence(await this.runs.finalize(run.id, owner, { outcome, reason, nonBusinessReason }));
    this.logger.log(`Import of ${run.brasiliaDate} ended ${outcome} (${reason})`);
    await this.recordHealth(outcome, reason, runMode);
    await this.alertAbout(run.id);
  }

  /**
   * The list is applied: refresh what reads it, run the collection pass, store its result and only
   * then complete the daily update (BR-004-23). Every step is idempotent: a process that died
   * anywhere in here is resumed by the next tick.
   */
  private async completeDay(run: ImportRunRecord, owner: string, runMode: RunMode): Promise<void> {
    try {
      await this.auctions.invalidateNeighborhoodsCache();
    } catch (error) {
      this.logger.warn(`Could not invalidate the neighborhoods cache: ${jobErrorCode(error)}`);
    }

    let collection: CollectionResult = { collected: 0, failed: 0, blocked: false };
    await this.assertHeld(run.id, owner); // never start a pass for a run another worker holds now
    try {
      collection = await this.enrichment.run({
        importRunId: run.id,
        brasiliaDate: run.brasiliaDate,
      });
    } catch (error) {
      // The update does not wait on a fault of the enrichment: the Radar and the digest still run.
      this.reportFault('The collection pass failed', error);
    }
    this.fence(await this.runs.saveCollection(run.id, owner, collection));

    // Exactly one caller wins this update, so the signal fires once per day (BR-004-23). Only a
    // worker that still holds the run completes it.
    await this.assertHeld(run.id, owner);
    if (await this.runs.completeUpdate(run.id)) {
      this.logger.log(`Daily update of ${run.brasiliaDate} complete`);
      await this.recordHealth('SUCCESS', null, runMode);
      void this.bus.emit({ importRunId: run.id, brasiliaDate: run.brasiliaDate });
    }
    await this.alertAbout(run.id); // a blocked collection (BR-004-29)
  }

  private async alertAbout(runId: string): Promise<void> {
    try {
      const latest = await this.runs.findById(runId);
      if (latest !== null) await this.alerts.alertIfDue(latest);
    } catch (error) {
      this.logger.error(`The import alert failed: ${jobErrorCode(error)}`);
    }
  }

  /**
   * GET /api/health reads `jobexecutions` (AR-48). Best-effort: a failure to record never changes
   * the run. SUCCESS only when the daily update completed. NO_UPDATE is a success too: the
   * pipeline did its job and Caixa published nothing (weekend or holiday), so health stays ok.
   */
  private async recordHealth(
    outcome: 'SUCCESS' | 'FAILED' | 'REJECTED_LIST' | 'NO_NEW_LIST' | 'NO_UPDATE',
    reason: string | null,
    runMode: RunMode,
  ): Promise<void> {
    try {
      if (outcome === 'SUCCESS' || outcome === 'NO_UPDATE') {
        await this.jobExecutions.recordExecution(AUCTIONS_IMPORT_JOB, runMode);
      } else {
        const code =
          outcome === 'REJECTED_LIST'
            ? 'LIST_REJECTED'
            : outcome === 'NO_NEW_LIST'
              ? 'NO_NEW_LIST'
              : (reason ?? 'FAILED');
        await this.jobExecutions.recordFailure(AUCTIONS_IMPORT_JOB, runMode, code);
      }
    } catch (error) {
      this.logger.error(
        `Could not record the import for the health report: ${jobErrorCode(error)}`,
      );
    }
  }

  /** Extends the lease while the worker works (an apply or a collection pass can outlast it). */
  private keepLease(id: string, owner: string): () => void {
    const timer = setInterval(() => {
      this.runs
        .renewLease(id, owner)
        .then((renewed) => {
          if (!renewed) this.logger.warn('The lease of a run could not be renewed');
        })
        .catch((error: unknown) => {
          this.logger.warn(`Could not renew a lease: ${jobErrorCode(error)}`);
        });
    }, this.leaseRenewMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  /** Before a fenced step that is long or has effects outside the row: still the holder? */
  private async assertHeld(id: string, owner: string): Promise<void> {
    this.fence(await this.runs.renewLease(id, owner));
  }

  private fence(written: boolean): void {
    if (!written) throw new LeaseLostError('The run is no longer held by this worker');
  }

  /** SC-15: the stable code in the log, the error itself (scrubbed, AR-47) to Sentry. */
  private reportFault(what: string, error: unknown): void {
    this.logger.error(`${what}: ${jobErrorCode(error)}`);
    captureException(error, { tags: { jobName: AUCTIONS_IMPORT_JOB } });
  }
}

function toState(run: ImportRunRecord): RunState {
  return {
    brasiliaDate: run.brasiliaDate,
    outcome: run.outcome,
    attempts: run.attempts,
    nextAttemptAt: run.nextAttemptAt,
    updateCompletedAt: run.updateCompletedAt,
    progress: run.progress,
  };
}
