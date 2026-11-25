import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { Clock } from '../../common/clock/clock.js';
import { PropertyChangeService } from '../changes/property-change.service.js';
import type { ChangeDraft } from '../domain/change-types.js';
import {
  becameUnavailableEntry,
  diffListRow,
  type ListRow,
  type RowDiff,
} from '../domain/list-diff.js';
import { sweepWithinLimit } from '../domain/list-validator.js';
import type { ImportCounts } from '../import-runs/import-run.js';
import { ListApplierRepository } from './list-applier.repository.js';

/** Rows read, diffed and written together. Bounds the `$in` of a read and the size of a bulk write. */
export const LIST_APPLY_CHUNK_SIZE = 500;

/**
 * The sweep would hide more properties than a day can plausibly end (see `sweepWithinLimit`). It is
 * thrown BEFORE anything is marked unavailable; the run ends FAILED with this class as its code.
 */
export class SweepAbortedError extends Error {
  override name = 'SweepAbortedError';
}

export interface ApplyInput {
  /** The Import Run this apply belongs to (hex ObjectId): the stamp and the key of the entries. */
  runId: string;
  /** The validated list's rows (BR-004-04): nothing is applied before the list passed. */
  rows: readonly ListRow[];
  /**
   * IMPORT_MIN_ROW_RATIO: no more than `1 - minRowRatio` of the available properties may be hidden
   * by this run. 0 allows any sweep (specs only).
   */
  minRowRatio: number;
  /** Rows per chunk; the default is LIST_APPLY_CHUNK_SIZE. */
  chunkSize?: number;
}

/**
 * SPEC-004 BR-004-05..09, BR-004-17, DL-004-04: applies a validated daily list to the catalogue.
 *
 * Idempotent, and safe if the process dies at any point: running it again with the same list ends
 * in the state an uninterrupted run would have. The order is what makes it so:
 *
 *  1. per chunk of rows: read the stored state, diff in memory (domain), write the change entries
 *     FIRST (`recordUnlessRepeated`: the unique run + property + field + type, and no entry that
 *     only repeats the newest of its property and field), then the property writes. A crash
 *     between the two leaves entries whose change the retry applies and records again, as the same
 *     entries, whether the retry is the same run or, the next day, another run id (BR-004-07); the
 *     other order would leave a change applied with no entry, and nothing could reconstruct the
 *     old value. The counts of a run that replays another run's entries do not include them: they
 *     belong to the run that wrote them.
 *  2. only after EVERY row was written: the properties the list did not contain are marked
 *     unavailable, entries first again (BR-004-08). Until then nothing is hidden, whatever
 *     happened to the run.
 *
 * Every listed row is stamped with the run, so "not in the list" is `lastSeenRunId != run`. A
 * property is never deleted (BR-004-17), and fields the list does not carry (rounds, payment
 * methods, occupancy, photos) are never written here, so what was not collected stays unknown
 * (BR-004-15).
 *
 * The counts come from what the database holds after the run (entries and stamps of this run), not
 * from this pass's memory, so a resumed run reports what the whole run did (BR-004-27).
 */
@Injectable()
export class ListApplier {
  private readonly logger = new Logger(ListApplier.name);

  constructor(
    private readonly properties: ListApplierRepository,
    private readonly changes: PropertyChangeService,
    private readonly clock: Clock, // AR-24
  ) {}

  async apply(input: ApplyInput): Promise<ImportCounts> {
    const runId = new Types.ObjectId(input.runId);
    const now = this.clock.now();
    const chunkSize = input.chunkSize ?? LIST_APPLY_CHUNK_SIZE;
    const rows = latestRowPerCode(input.rows);

    // The catalogue the list is judged against: counted before this run writes anything.
    const availableBefore = await this.properties.countAvailable();

    let skipped = 0;
    for (let at = 0; at < rows.length; at += chunkSize) {
      skipped += await this.applyChunk(input.runId, runId, rows.slice(at, at + chunkSize), now);
    }
    if (skipped > 0) {
      // Counts only (SC-15): rows whose modality is unknown cannot be stored as new.
      this.logger.warn(`List apply skipped ${skipped} new rows with an unknown modality`);
    }

    await this.markAbsentUnavailable(input.runId, runId, now, chunkSize, {
      availableBefore,
      minRowRatio: input.minRowRatio,
    });

    const counts: ImportCounts = {
      new: await this.changes.countByType(input.runId, 'NEW'),
      changed: await this.properties.countChanged(runId),
      unavailable: await this.changes.countByType(input.runId, 'BECAME_UNAVAILABLE'),
      active: await this.properties.countActive(now),
    };
    this.logger.log(
      `List applied: ${rows.length} rows, new ${counts.new}, changed ${counts.changed}, unavailable ${counts.unavailable}, active ${counts.active}`,
    );
    return counts;
  }

  /** Returns how many rows were skipped (not storable). */
  private async applyChunk(
    runKey: string,
    runId: Types.ObjectId,
    rows: readonly ListRow[],
    now: Date,
  ): Promise<number> {
    const states = await this.properties.findStates(
      rows.map((row) => row.code),
      now,
    );
    const diffs = new Map<string, Exclude<RowDiff, { kind: 'skip' }>>();
    const entries: ChangeDraft[] = [];
    let skipped = 0;

    for (const row of rows) {
      const diff = diffListRow(states.get(row.code) ?? null, row);
      if (diff.kind === 'skip') {
        skipped++;
        continue;
      }
      if (diff.kind === 'insert' || diff.kind === 'update') entries.push(...diff.entries);
      diffs.set(row.code, diff);
    }

    await this.changes.recordUnlessRepeated(runKey, entries, now);
    await this.properties.applyChunk({ diffs, runId, now });
    return skipped;
  }

  /** BR-004-08, DL-004-04: after all rows; entries before the flag, chunk by chunk, by code. */
  private async markAbsentUnavailable(
    runKey: string,
    runId: Types.ObjectId,
    now: Date,
    chunkSize: number,
    guard: { availableBefore: number; minRowRatio: number },
  ): Promise<void> {
    // BR-004-08, DL-004-03: refuse BEFORE the first flag, so an aborted sweep has hidden nothing.
    const unseen = await this.properties.countUnseenAvailable(runId);
    if (!sweepWithinLimit(unseen, guard.availableBefore, guard.minRowRatio)) {
      this.logger.error(
        `List sweep aborted: ${unseen} of ${guard.availableBefore} available properties are not in the list`,
      );
      throw new SweepAbortedError('The list would hide too many properties');
    }
    let after: string | null = null;
    for (;;) {
      const codes = await this.properties.findUnseenAvailable(runId, after, chunkSize);
      const last = codes[codes.length - 1];
      if (last === undefined) return;
      await this.changes.recordUnlessRepeated(runKey, codes.map(becameUnavailableEntry), now);
      await this.properties.markUnavailable(runId, codes, now);
      after = last;
    }
  }
}

/** A code listed twice is applied once, as its last row says. */
function latestRowPerCode(rows: readonly ListRow[]): ListRow[] {
  return [...new Map(rows.map((row) => [row.code, row])).values()];
}
