import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import { brasiliaToday } from '../../common/clock/brasilia-time.js';
import { addCalendarDays } from '../../common/domain/business-day.js';
import type { PageRequest, Paginated } from '../../common/pagination/paginated.js';
import { paginated } from '../../common/pagination/paginated.js';
import type { LastAppliedList } from '../domain/list-validator.js';
import type {
  ImportCounts,
  ImportOutcome,
  ImportRunRecord,
  NonBusinessReason,
} from './import-run.js';
import { ImportRunRepository } from './import-run.repository.js';

/** An alert that could not be sent is retried for this many days, then dropped. */
export const ALERT_LOOKBACK_DAYS = 2;

/** How long a worker holds a run before another may take it over; renewed while it works. */
export const RUN_LEASE_MS = 5 * 60_000;

/**
 * SPEC-004 BR-004-27: the Import Run of each Brasília day, and what is done to it.
 *
 *   - one run per Brasília date (`ensure`), created for the day of the attempt and kept across
 *     midnight;
 *   - a run is worked by one holder at a time: `acquireLease` is an atomic conditional update, the
 *     lease expires if the holder dies, and every write of the worker is fenced on it;
 *   - SUCCESS is final for the day; a decided outcome (FAILED, REJECTED_LIST, NO_NEW_LIST,
 *     NO_UPDATE) is final too and changes no property data (BR-004-10);
 *   - "daily update complete" is `completeUpdate`, true for exactly one caller (BR-004-23);
 *   - the one alert of a run is `claimAlert` (BR-004-29).
 *
 * The state machine itself is the pure `decideNextAction` (domain/import-schedule.ts); the
 * orchestrator carries its decisions out through this service.
 */
@Injectable()
export class ImportRunService {
  constructor(
    private readonly runs: ImportRunRepository,
    private readonly clock: Clock, // AR-24
  ) {}

  findByDate(brasiliaDate: string): Promise<ImportRunRecord | null> {
    return this.runs.findByDate(brasiliaDate);
  }

  findById(id: string): Promise<ImportRunRecord | null> {
    return this.runs.findById(id);
  }

  /**
   * The list applied last (BR-004-02, BR-004-04): the generation day and row count of the newest
   * SUCCESS run, or null before any run succeeded.
   */
  async lastAppliedList(): Promise<LastAppliedList | null> {
    const last = await this.runs.findLastSuccess();
    if (last === null || last.listGeneratedAt === null) return null;
    return { generatedOn: last.listGeneratedAt, rowCount: last.listRows };
  }

  /**
   * BR-004-24: when the last daily update finished, an instant (the frontend formats it in
   * Brasília time), or null before any update completed. Only a run whose update completed counts:
   * a failed, rejected, no-new-list or no-update day moves nothing. It is the moment the update
   * completed (applied, collected, signalled), which is what the signal is.
   */
  async lastUpdateAt(): Promise<Date | null> {
    const last = await this.runs.findLastCompleted();
    return last?.updateCompletedAt ?? null;
  }

  /** BR-004-28: the runs, newest first. */
  async findPage(request: PageRequest): Promise<Paginated<ImportRunRecord>> {
    const { items, total } = await this.runs.findPage(request);
    return paginated(items, total, request);
  }

  /** The runs a tick has work for (see the repository). */
  findOpen(): Promise<ImportRunRecord[]> {
    return this.runs.findOpen();
  }

  /**
   * The runs that may still owe the admins an alert (BR-004-29): those of the last
   * `ALERT_LOOKBACK_DAYS` Brasília days. Older rows never email (a first deploy over history).
   */
  findAlertCandidates(): Promise<ImportRunRecord[]> {
    const since = addCalendarDays(brasiliaToday(this.clock), -ALERT_LOOKBACK_DAYS);
    return this.runs.findAlertCandidates(since);
  }

  clearApplying(id: string, owner: string): Promise<boolean> {
    return this.runs.clearApplying(id, owner);
  }

  /** The day's run, created if the day has none. */
  ensure(brasiliaDate: string): Promise<ImportRunRecord> {
    return this.runs.ensure(brasiliaDate, this.clock.now());
  }

  /** The run, taken for `owner` for RUN_LEASE_MS; null when somebody else holds it. */
  acquireLease(id: string, owner: string): Promise<ImportRunRecord | null> {
    const now = this.clock.now();
    return this.runs.acquireLease(id, owner, now, new Date(now.getTime() + RUN_LEASE_MS));
  }

  renewLease(id: string, owner: string): Promise<boolean> {
    return this.runs.renewLease(id, owner, new Date(this.clock.now().getTime() + RUN_LEASE_MS));
  }

  releaseLease(id: string, owner: string): Promise<void> {
    return this.runs.releaseLease(id, owner);
  }

  beginAttempt(id: string, owner: string, nextAttemptAt: Date): Promise<boolean> {
    return this.runs.beginAttempt(id, owner, nextAttemptAt);
  }

  markListReached(id: string, owner: string): Promise<boolean> {
    return this.runs.markListReached(id, owner);
  }

  recordRejection(
    id: string,
    owner: string,
    rejection: { generatedOn: string | null; reason: string; rows: number },
  ): Promise<boolean> {
    return this.runs.recordRejection(id, owner, rejection);
  }

  /** A stable failure code, never a message (SC-15). */
  recordFailureCode(id: string, owner: string, code: string): Promise<boolean> {
    return this.runs.recordFailureCode(id, owner, code);
  }

  beginApply(
    id: string,
    owner: string,
    list: { generatedOn: string; rows: number },
  ): Promise<boolean> {
    return this.runs.beginApply(id, owner, list);
  }

  markApplyFailed(id: string, owner: string, code: string): Promise<boolean> {
    return this.runs.markApplyFailed(id, owner, code);
  }

  markSuccess(id: string, owner: string, counts: ImportCounts): Promise<boolean> {
    return this.runs.markSuccess(id, owner, counts, this.clock.now());
  }

  finalize(
    id: string,
    owner: string,
    decision: {
      outcome: Exclude<ImportOutcome, 'RUNNING' | 'SUCCESS'>;
      reason: string;
      nonBusinessReason: NonBusinessReason | null;
    },
  ): Promise<boolean> {
    return this.runs.finalize(id, owner, decision, this.clock.now());
  }

  /**
   * The block and the end of the day in ONE fenced write (BR-004-20, SC-24, AR-03): FAILED with the
   * block's reason and `code` (LIST_BLOCKED) among the failure reasons.
   */
  finalizeBlocked(
    id: string,
    owner: string,
    block: { reason: string; code: string },
  ): Promise<boolean> {
    return this.runs.finalizeBlocked(id, owner, block, this.clock.now());
  }

  saveCollection(
    id: string,
    owner: string,
    collection: {
      collected: number;
      failed: number;
      blocked: boolean;
      pages: number;
      requests: number;
    },
  ): Promise<boolean> {
    return this.runs.saveCollection(id, owner, collection);
  }

  /** BR-004-23: true for exactly one caller; that caller emits the signal. */
  completeUpdate(id: string): Promise<boolean> {
    return this.runs.completeUpdate(id, this.clock.now());
  }

  claimAlert(id: string): Promise<boolean> {
    return this.runs.claimAlert(id, this.clock.now());
  }

  releaseAlert(id: string): Promise<void> {
    return this.runs.releaseAlert(id);
  }
}
