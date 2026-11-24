import { Inject, Injectable, Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { Clock } from '../../common/clock/clock.js';
import { Sleeper } from '../../common/clock/sleeper.js';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import businessConfig, { type BusinessConfig } from '../../config/business.config.js';
import schedulerConfig, { type SchedulerConfig } from '../../config/scheduler.config.js';
import {
  CaixaAccess,
  CaixaBlockedError,
  CaixaUnreachableError,
  CaixaUrlRefusedError,
} from '../caixa/caixa-access.js';
import { retryAfter, stopsThePass } from '../domain/detail-failure.js';
import { selectEnrichmentBatch, type QueueEntry } from '../domain/enrichment-queue.js';
import { AUCTIONS_IMPORT_JOB } from '../importer/import-job.js';
import { LeaseLostError } from '../import-runs/lease-lost.error.js';
import { DetailApplier } from './detail-applier.js';
import { scrapeAuctionDetails } from './details-scraper.js';
import {
  type CollectionResult,
  EnrichmentPass,
  type EnrichmentPassInput,
} from './enrichment-pass.js';
import { EnrichmentRepository, type StoredForCollection } from './enrichment.repository.js';
import { PropertyCopier } from './property-copier.js';
import { RateGate } from './rate-gate.js';

/** What one pass shares between its workers. */
interface PassContext {
  input: EnrichmentPassInput;
  totals: CollectionResult;
  /** The writes of the totals, in the order they were asked for (concurrent workers share them). */
  saves: Promise<void>;
  /** The instant the pass began: the zero of the offsets in the collection log. */
  startedAtMs: number;
  stopped: boolean;
  stopReason: string | null;
  consecutiveFailures: number;
}

/**
 * SPEC-004 BR-004-18..22, BR-004-30 (part 4): the real `EnrichmentPass`. Once the day's list is
 * applied, it collects detail pages from Caixa under the daily budget:
 *
 *   queue    `selectEnrichmentBatch`: new or returned first, then changed today, then the oldest
 *            refreshes (BR-004-19), at most the pages the day has left (counted across passes);
 *   rate     every request - page, photo, document - passes ONE `RateGate`: at most
 *            ENRICHMENT_CONCURRENCY in flight, ENRICHMENT_MIN_PAUSE_MS between starts (BR-004-18,
 *            SC-24); each request leaves one structured line in the log, so the rate can be checked
 *            from it (docs/runbooks/caixa-import.md);
 *   lease    the run's lease is checked before EVERY request (`assertHeld`): a stalled worker stops
 *            quietly (LeaseLostError) and the next tick resumes from the persisted totals;
 *   block    any block, challenge or rate-limit answer stops the whole pass at once: no more
 *            requests today, `blocked` on the run, resumed by the next day's run (BR-004-20). Never
 *            retried, never answered (SC-24);
 *   failure  one property's failed page (unreachable, timed out, unreadable) keeps its previous data,
 *            is backed off and counted `failed`; ENRICHMENT_MAX_CONSECUTIVE_FAILURES in a row stop
 *            the pass (not a block, BR-004-21).
 *
 * The fetching is `CaixaAccess` (AR-10): no browser. SCRAPER_ENABLED=false makes the pass collect
 * nothing, and the daily update still completes.
 *
 * Logs carry property numbers, outcome codes and counts only (SC-15): never a URL, a page's text or
 * a file's content.
 */
@Injectable()
export class DetailEnrichmentPass extends EnrichmentPass {
  private readonly logger = new Logger(DetailEnrichmentPass.name);
  /**
   * The ONE gate of the process (SC-24): the provider is a singleton, so passes of two runs that
   * overlap (a day's pass that outlasts midnight) still share the pause and the concurrency.
   * Several instances of the API would each have their own: unsupported until a database-backed
   * gate exists (docs/runbooks/caixa-import.md).
   */
  private readonly gate: RateGate;
  /** The end of the last pass asked for: a pass starts only after the one before it ended. */
  private lastPass: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly caixa: CaixaAccess,
    private readonly properties: EnrichmentRepository,
    private readonly copier: PropertyCopier,
    private readonly applier: DetailApplier,
    private readonly clock: Clock, // AR-24
    private readonly sleeper: Sleeper,
    @Inject(schedulerConfig.KEY) private readonly scheduler: SchedulerConfig,
    @Inject(businessConfig.KEY) private readonly business: BusinessConfig,
  ) {
    super();
    this.gate = new RateGate(clock, sleeper, {
      concurrency: business.enrichment.concurrency,
      minPauseMs: business.enrichment.minPauseMs,
    });
  }

  /**
   * One pass at a time in this process: a pass for day D+1 never starts while day D's still runs
   * (it waits, its run's lease being renewed meanwhile by the orchestrator's heartbeat).
   */
  async run(input: EnrichmentPassInput): Promise<CollectionResult> {
    const before = this.lastPass;
    let ended: () => void = () => undefined;
    this.lastPass = new Promise<void>((resolve) => {
      ended = resolve;
    });
    await before;
    try {
      return await this.runAlone(input);
    } finally {
      ended();
    }
  }

  private async runAlone(input: EnrichmentPassInput): Promise<CollectionResult> {
    if (!this.scheduler.scraper.enabled) {
      this.logger.log('The detail collection is off (SCRAPER_ENABLED=false): nothing is collected');
      return input.previous;
    }
    const cfg = this.business.enrichment;
    const totals = { ...input.previous };
    if (totals.blocked) {
      this.logger.warn("Caixa already blocked today's collection: no more requests until tomorrow");
      return totals;
    }
    const remaining = cfg.dailyPages - totals.pages;
    if (remaining <= 0) {
      this.logger.log(`The daily page budget (${cfg.dailyPages}) is spent: out of budget`);
      return totals;
    }
    if (totals.requests >= cfg.dailyRequests) {
      this.logger.log(`The daily request cap (${cfg.dailyRequests}) is spent: out of budget`);
      return totals;
    }

    const now = this.clock.now();
    const candidates = await this.properties.findCandidates({
      runId: input.importRunId,
      now,
      limit: remaining,
      maxStalenessDays: cfg.maxStalenessDays,
    });
    const batch = selectEnrichmentBatch(candidates, {
      runId: input.importRunId,
      now,
      budget: remaining,
      maxStalenessDays: cfg.maxStalenessDays,
    });
    this.logger.log(
      `Detail collection starts: ${batch.length} pages queued (${tierCounts(batch)}), ${remaining} of ${cfg.dailyPages} left today`,
    );

    const context: PassContext = {
      input,
      totals,
      saves: Promise.resolve(),
      startedAtMs: now.getTime(),
      stopped: false,
      stopReason: null,
      consecutiveFailures: 0,
    };
    const queue = [...batch];
    const worker = async (): Promise<void> => {
      for (
        let entry = queue.shift();
        entry !== undefined && !context.stopped;
        entry = queue.shift()
      ) {
        await this.collectOne(entry, context);
      }
    };
    const outcomes = await Promise.allSettled(
      Array.from({ length: Math.min(cfg.concurrency, Math.max(batch.length, 1)) }, worker),
    );
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure !== undefined) {
      // A lease lost (quiet: the orchestrator ends the tick) or a fault the orchestrator reports.
      context.stopped = true;
      throw (failure as PromiseRejectedResult).reason;
    }

    const state =
      context.stopReason ??
      (queue.length === 0 && batch.length === remaining ? 'OUT_OF_BUDGET' : 'DONE');
    this.logger.log(
      `Detail collection ended (${state}): collected ${totals.collected}, failed ${totals.failed}, pages today ${totals.pages} of ${cfg.dailyPages}, blocked ${totals.blocked}`,
    );
    return totals;
  }

  /** One property: its page, its copies, its data. Never throws for the property's own failure. */
  private async collectOne(entry: QueueEntry, context: PassContext): Promise<void> {
    const { code } = entry;
    const stored = await this.properties.findForCollection(code);
    if (stored === null || !stored.available || stored.detailsUrl === null) return;

    let html: string;
    try {
      html = await this.request(context, 'page', code, () =>
        this.caixa.fetchDetailPage(stored.detailsUrl as string),
      );
    } catch (error) {
      // A transport failure was counted toward the stop by `request` itself.
      await this.pageFailed(context, stored, error, false);
      return;
    }

    const read = scrapeAuctionDetails(html);
    if (read.kind === 'blocked') {
      await this.blocked(context, 'CHALLENGE_PAGE');
      return;
    }
    if (read.kind !== 'page') {
      // `unavailable` is no verdict (the LIST decides availability, BR-004-08) and `unrecognised`
      // is a layout this reader does not know: a failed fetch of this property, backed off, but
      // NOT a sign that the way to Caixa is broken: a run of sold-out pages must not stop the day.
      await this.failed(
        context,
        stored,
        read.kind === 'unavailable' ? 'PAGE_UNAVAILABLE' : 'PAGE_UNRECOGNISED',
        false,
      );
      return;
    }

    const now = this.clock.now();
    try {
      const copies = await this.copier.plan(
        stored,
        read.page,
        (url) => this.request(context, 'file', code, () => this.caixa.fetchFile(url)),
        now,
      );
      for (const { kind, reason } of copies.rejections) {
        this.logger.warn(`collection.copy code=${code} kind=${kind} outcome=${reason}`);
      }
      const entries = await this.applier.apply({
        runId: context.input.importRunId,
        stored,
        page: read.page,
        copies,
        now,
      });
      context.totals.collected++;
      this.logger.log(`collection.property code=${code} outcome=COLLECTED changes=${entries}`);
    } catch (error) {
      // Nothing of this property was written if a copy was blocked or the pass stopped mid-way: it
      // is retried next run.
      await this.pageFailed(context, stored, error, true);
      return;
    }
    await this.save(context);
  }

  /**
   * A request to Caixa: behind the gate, and one line in the log. Once admitted, in this order:
   * (1) a pass that was stopped meanwhile (a block, the failures in a row, the request cap) sends
   * nothing: a worker waiting at the gate or admitted late must not ask Caixa again after a
   * refusal (SC-24); (2) the lease is checked; (3) the request is COUNTED and persisted BEFORE it is
   * sent, so a lease lost right after cannot let the day exceed its budget; (4) it is sent.
   */
  private request<T>(
    context: PassContext,
    kind: 'page' | 'file',
    code: string,
    send: () => Promise<T>,
  ): Promise<T> {
    return this.gate.run(async ({ startedAt }) => {
      if (context.stopped) throw new PassStoppedSignal();
      await context.input.assertHeld(); // before EVERY request: a stalled worker never asks Caixa
      if (context.totals.requests >= this.business.enrichment.dailyRequests) {
        this.stop(context, 'OUT_OF_REQUESTS');
        throw new PassStoppedSignal();
      }
      context.totals.requests++;
      if (kind === 'page') context.totals.pages++;
      await this.save(context);

      let outcome = 'OK';
      try {
        const answer = await send();
        context.consecutiveFailures = 0; // the way to Caixa works
        return answer;
      } catch (error) {
        outcome = requestOutcome(error);
        // Only a failure of the way itself counts toward the stop: not a block (that has its own
        // rule), not a lease lost, not a missing file. A timeout of a photo counts as much as one
        // of a page.
        if (isBrokenWay(error)) this.countFailureInARow(context);
        throw error;
      } finally {
        // Offsets from the pass start, ms: starts at least the pause apart, in flight at most the
        // configured concurrency. No URL, no content (SC-15).
        this.logger.log(
          `collection.request kind=${kind} code=${code} outcome=${outcome} startMs=${startedAt.getTime() - context.startedAtMs} endMs=${this.clock.now().getTime() - context.startedAtMs}`,
        );
      }
    });
  }

  /** Persists the day's totals, writes in the order they were asked for. */
  private save(context: PassContext): Promise<void> {
    const snapshot = { ...context.totals };
    const write = context.saves.then(() => context.input.saveProgress(snapshot));
    context.saves = write.catch(() => undefined); // a failed write must not wedge the next
    return write;
  }

  /** The pass ends for the day: workers still waiting send nothing. */
  private stop(context: PassContext, reason: string): void {
    context.stopped = true;
    context.stopReason ??= reason;
  }

  private countFailureInARow(context: PassContext): void {
    context.consecutiveFailures++;
    if (
      stopsThePass(context.consecutiveFailures, this.business.enrichment.maxConsecutiveFailures)
    ) {
      this.stop(context, 'CONSECUTIVE_FAILURES');
      this.logger.warn(
        `collection.stopped reason=CONSECUTIVE_FAILURES after ${context.consecutiveFailures} in a row: something is wrong on the way to Caixa (not a block)`,
      );
    }
  }

  /** The way a request or the work after it failed decides what the pass does next. */
  private async pageFailed(
    context: PassContext,
    stored: StoredForCollection,
    error: unknown,
    countsTowardStop: boolean,
  ): Promise<void> {
    if (error instanceof LeaseLostError) throw error;
    if (error instanceof PassStoppedSignal) return; // not this property's failure: not counted
    if (error instanceof CaixaBlockedError) {
      captureException(error, { tags: { jobName: AUCTIONS_IMPORT_JOB } });
      await this.blocked(context, error.reason);
      return;
    }
    await this.failed(context, stored, requestOutcome(error), countsTowardStop);
  }

  /** BR-004-20, SC-24: the whole pass stops, nothing is retried or worked around. */
  private async blocked(context: PassContext, reason: string): Promise<void> {
    context.totals.blocked = true;
    this.stop(context, 'BLOCKED');
    this.logger.warn(
      `collection.blocked reason=${reason}: the pass stops here, tomorrow's run resumes`,
    );
    await this.save(context);
  }

  /** BR-004-21: this property keeps its data, waits out a back-off, and is counted failed. */
  private async failed(
    context: PassContext,
    stored: StoredForCollection,
    outcome: string,
    countsTowardStop: boolean,
  ): Promise<void> {
    const cfg = this.business.enrichment;
    const failures = stored.detailsFailures + 1;
    await this.properties.recordFailure(
      stored.code,
      failures,
      retryAfter(this.clock.now(), cfg.failureBackoffDays, failures),
    );
    context.totals.failed++;
    if (countsTowardStop) this.countFailureInARow(context);
    this.logger.warn(
      `collection.property code=${stored.code} outcome=${outcome} failures=${failures} inARow=${context.consecutiveFailures}`,
    );
    await this.save(context);
  }
}

/**
 * Thrown inside the gate when the pass was stopped while this request waited: it is no failure of
 * the property, nothing is counted, nothing was sent.
 */
class PassStoppedSignal extends Error {
  override name = 'PassStoppedSignal';
}

/** A timeout, a network failure or a 5xx: something is wrong on the way to Caixa, not with one file. */
function isBrokenWay(error: unknown): boolean {
  if (!(error instanceof CaixaUnreachableError)) return false;
  return (
    error.reason === 'TIMEOUT' ||
    error.reason === 'NETWORK' ||
    (error.reason === 'HTTP_STATUS' && (error.status ?? 0) >= 500)
  );
}

/** A stable code for how a request or the work around it ended (SC-15: never a message). */
function requestOutcome(error: unknown): string {
  if (error instanceof CaixaBlockedError) return `BLOCKED_${error.reason}`;
  if (error instanceof CaixaUnreachableError) return `UNREACHABLE_${error.reason}`;
  if (error instanceof CaixaUrlRefusedError) return 'URL_REFUSED';
  return `ERROR_${jobErrorCode(error)}`;
}

function tierCounts(batch: readonly QueueEntry[]): string {
  const count = (tier: QueueEntry['tier']) => batch.filter((entry) => entry.tier === tier).length;
  return `new ${count('NEW')}, changed ${count('CHANGED')}, refresh ${count('REFRESH')}`;
}
