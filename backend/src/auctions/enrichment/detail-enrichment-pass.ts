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
  gate: RateGate;
  totals: CollectionResult;
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
  }

  async run(input: EnrichmentPassInput): Promise<CollectionResult> {
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
      gate: new RateGate(this.clock, this.sleeper, {
        concurrency: cfg.concurrency,
        minPauseMs: cfg.minPauseMs,
      }),
      totals,
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

    context.totals.pages++;
    let html: string;
    try {
      html = await this.request(context, 'page', code, () =>
        this.caixa.fetchDetailPage(stored.detailsUrl as string),
      );
    } catch (error) {
      await this.pageFailed(context, stored, error);
      return;
    }

    const read = scrapeAuctionDetails(html);
    if (read.kind === 'blocked') {
      await this.blocked(context, 'CHALLENGE_PAGE');
      return;
    }
    if (read.kind !== 'page') {
      // `unavailable` is no verdict (the LIST decides availability, BR-004-08) and `unrecognised`
      // is a layout this reader does not know: both are a failed fetch of this property.
      await this.failed(
        context,
        stored,
        read.kind === 'unavailable' ? 'PAGE_UNAVAILABLE' : 'PAGE_UNRECOGNISED',
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
      context.consecutiveFailures = 0;
      this.logger.log(`collection.property code=${code} outcome=COLLECTED changes=${entries}`);
    } catch (error) {
      // Nothing of this property was written if a copy was blocked mid-way: it is retried next run.
      await this.pageFailed(context, stored, error);
      return;
    }
    await context.input.saveProgress({ ...context.totals });
  }

  /** A request to Caixa: behind the gate, after the lease check, and one line in the log. */
  private request<T>(
    context: PassContext,
    kind: 'page' | 'file',
    code: string,
    send: () => Promise<T>,
  ): Promise<T> {
    return context.gate.run(async ({ startedAt }) => {
      await context.input.assertHeld(); // before EVERY request: a stalled worker never asks Caixa
      let outcome = 'OK';
      try {
        return await send();
      } catch (error) {
        outcome = requestOutcome(error);
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

  /** The way a request or the work after it failed decides what the pass does next. */
  private async pageFailed(
    context: PassContext,
    stored: StoredForCollection,
    error: unknown,
  ): Promise<void> {
    if (error instanceof LeaseLostError) throw error;
    if (error instanceof CaixaBlockedError) {
      captureException(error, { tags: { jobName: AUCTIONS_IMPORT_JOB } });
      await this.blocked(context, error.reason);
      return;
    }
    await this.failed(context, stored, requestOutcome(error));
  }

  /** BR-004-20, SC-24: the whole pass stops, nothing is retried or worked around. */
  private async blocked(context: PassContext, reason: string): Promise<void> {
    context.totals.blocked = true;
    context.stopped = true;
    context.stopReason = 'BLOCKED';
    this.logger.warn(
      `collection.blocked reason=${reason}: the pass stops here, tomorrow's run resumes`,
    );
    await context.input.saveProgress({ ...context.totals });
  }

  /** BR-004-21: this property keeps its data, waits out a back-off, and is counted failed. */
  private async failed(
    context: PassContext,
    stored: StoredForCollection,
    outcome: string,
  ): Promise<void> {
    const cfg = this.business.enrichment;
    const failures = stored.detailsFailures + 1;
    await this.properties.recordFailure(
      stored.code,
      failures,
      retryAfter(this.clock.now(), cfg.failureBackoffDays, failures),
    );
    context.totals.failed++;
    context.consecutiveFailures++;
    this.logger.warn(
      `collection.property code=${stored.code} outcome=${outcome} failures=${failures} inARow=${context.consecutiveFailures}`,
    );
    if (stopsThePass(context.consecutiveFailures, cfg.maxConsecutiveFailures)) {
      context.stopped = true;
      context.stopReason = 'CONSECUTIVE_FAILURES';
      this.logger.warn(
        `collection.stopped reason=CONSECUTIVE_FAILURES after ${context.consecutiveFailures} in a row: something is wrong on the way to Caixa (not a block)`,
      );
    }
    await context.input.saveProgress({ ...context.totals });
  }
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
