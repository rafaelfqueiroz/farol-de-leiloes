import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import type { LastAppliedList } from '../domain/list-validator.js';
import type { ImportCounts, ImportOutcome, ImportRunRecord } from './import-run.js';
import { ImportRunRepository } from './import-run.repository.js';

/**
 * SPEC-004 BR-004-27: the Import Run of each Brasília day. This is the minimal rule of the
 * single-attempt flow (part 2); the window, cutoff, retries, lease and alerts build on it (part 3).
 *
 *   - one run per Brasília date: a second attempt the same day reuses the row;
 *   - a SUCCESS run is final for its day; a RUNNING one (its process may have died) is entered
 *     again, which is safe because applying a list is idempotent (BR-004-07);
 *   - REJECTED_LIST, NO_NEW_LIST and FAILED change no property data (BR-004-10).
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

  /**
   * The list applied last (BR-004-02, BR-004-04): the generation day and row count of the newest
   * SUCCESS run, or null before any run succeeded.
   */
  async lastAppliedList(): Promise<LastAppliedList | null> {
    const last = await this.runs.findLastSuccess();
    if (last === null || last.listGeneratedAt === null) return null;
    return { generatedOn: last.listGeneratedAt, rowCount: last.listRows };
  }

  /** Null when the day's run is already SUCCESS. */
  begin(
    brasiliaDate: string,
    list: { generatedOn: string; rows: number },
  ): Promise<ImportRunRecord | null> {
    return this.runs.begin(brasiliaDate, list, this.clock.now());
  }

  /** BR-004-10: the day ends without applying anything. A stable reason code, never a message. */
  recordWithoutApply(
    brasiliaDate: string,
    outcome: Exclude<ImportOutcome, 'RUNNING' | 'SUCCESS'>,
    reason: string,
    list: { generatedOn: string | null; rows: number } = { generatedOn: null, rows: 0 },
  ): Promise<ImportRunRecord | null> {
    return this.runs.recordWithoutApply(brasiliaDate, outcome, reason, list, this.clock.now());
  }

  markSuccess(id: string, counts: ImportCounts): Promise<boolean> {
    return this.runs.markSuccess(id, counts, this.clock.now());
  }

  markFailed(id: string, code: string): Promise<boolean> {
    return this.runs.markFailed(id, code, this.clock.now());
  }
}
