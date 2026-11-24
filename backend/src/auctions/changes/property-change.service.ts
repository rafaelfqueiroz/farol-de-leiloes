import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { type ChangeDraft, type ChangeType, isRepeat } from '../domain/change-types.js';

/** How far back on a field a repeat is looked for: a field changes a handful of times a week. */
const RECENT_ENTRIES = 10;
import {
  type ChangeCursor,
  PropertyChangeRepository,
  type PropertyChangeRecord,
} from './property-change.repository.js';

/**
 * SPEC-004 BR-004-25, BR-004-26, DL-004-08: the one place property changes are written and read.
 * The Radar (SPEC-013) and the digest (SPEC-008) read these entries and never compare property
 * data themselves.
 *
 * Consumers read by TIME, not by run (`findSince`, `findCreatedBetween`): everything not yet
 * processed, whichever run wrote it. An entry is written before the property write it describes,
 * so a run that dies leaves entries whose changes the retry then applies; the retry finds those
 * entries in place and writes none of them again. Reading by cursor therefore delivers each
 * change once, when it was first written, and never loses one because the run that wrote it
 * failed. (Read after the day's update completed, BR-004-23, so no write is still in flight.)
 */
@Injectable()
export class PropertyChangeService {
  constructor(private readonly changes: PropertyChangeRepository) {}

  /** Idempotent (unique run + property + field + type): the same entries again change nothing. */
  async record(runId: string, drafts: readonly ChangeDraft[], now: Date): Promise<void> {
    await this.changes.upsertMany(new Types.ObjectId(runId), drafts, now);
  }

  /**
   * Like `record`, for every entry a run writes before the write it describes (the list, the
   * detail collection, the clock; BR-004-07, BR-004-25): an entry that only repeats what is already
   * the newest on its field (`isRepeat`) is left out. A run that died after its entries and
   * before the write they describe is retried under ANOTHER run id when the retry is the next
   * day's run, so the unique key (which holds the run) alone would record the same change twice,
   * and a consumer reading by cursor would be told twice; the change was already told, once.
   * The entries of one call are read against the history in ONE query, not one per entry.
   */
  async recordUnlessRepeated(
    runId: string,
    drafts: readonly ChangeDraft[],
    now: Date,
  ): Promise<void> {
    if (drafts.length === 0) return;
    const recent = await this.changes.findRecentByFields(
      [...new Set(drafts.map((draft) => draft.propertyCode))],
      [...new Set(drafts.map((draft) => draft.field))],
      RECENT_ENTRIES,
    );
    const fresh = drafts.filter(
      (draft) => !isRepeat(draft, recent.get(draft.propertyCode)?.get(draft.field) ?? []),
    );
    await this.record(runId, fresh, now);
  }

  countByType(runId: string, type: ChangeType): Promise<number> {
    return this.changes.countByRunAndType(new Types.ObjectId(runId), type);
  }

  /**
   * The entries written after `cursor` (all when null), oldest first. Answers the cursor to pass
   * next time: the last entry returned, or `cursor` itself when there was nothing new. Not limited
   * to relevant entries unless asked.
   */
  async findSince(
    cursor: ChangeCursor | null,
    options: { relevantOnly?: boolean; limit?: number } = {},
  ): Promise<{ items: PropertyChangeRecord[]; cursor: ChangeCursor | null }> {
    const items = await this.changes.findSince(cursor, {
      relevantOnly: options.relevantOnly ?? true,
      limit: options.limit ?? 500,
    });
    const last = items[items.length - 1];
    return { items, cursor: last ? { createdAt: last.createdAt, id: last.id } : cursor };
  }

  /** The entries created in [from, to), oldest first; relevant only by default. */
  findCreatedBetween(
    from: Date,
    to: Date,
    options: { relevantOnly?: boolean } = {},
  ): Promise<PropertyChangeRecord[]> {
    return this.changes.findCreatedBetween(from, to, options.relevantOnly ?? true);
  }

  /** Every entry of a run, by property and field. */
  findByRun(runId: string): Promise<PropertyChangeRecord[]> {
    return this.changes.findByRun(new Types.ObjectId(runId));
  }

  /** The newest entries of one property, newest first. */
  findByCode(code: string, limit = 50): Promise<PropertyChangeRecord[]> {
    return this.changes.findByCode(code, limit);
  }
}
