// SPEC-004 BR-004-18, BR-004-19, BR-004-21: which detail pages the day's pass collects, and in what
// order. Pure (AR-05): the candidates the repository read and "now" go in, the ordered batch comes
// out; "now" is an argument (AR-24).
//
// Order of collection within the budget (BR-004-19):
//   1. NEW       - seen for the first time or returned: its detail data was never collected (or was
//                  dropped when it came back), `detailsCollectedAt` null or `fulfilled` false;
//   2. CHANGED   - its list row changed in today's run (`lastChangedRunId` is the run's);
//   3. REFRESH   - every other ACTIVE property whose detail data is N or more Brasília days old,
//                  or whose last collection failed and whose back-off is over (a retry, BR-004-21),
//                  oldest first. N is ENRICHMENT_MAX_STALENESS_DAYS: a budget of at least
//                  (active properties / N) pages a day keeps every one of them within N days.
//
// Never collected: a property the list marks unavailable (only the list decides availability,
// BR-004-08), one already collected on today's Brasília day (a resumed pass never repeats a page),
// one in back-off after a failed page (`detailsRetryAfter` still ahead, BR-004-21), one with no
// page to ask for.
import { brasiliaCalendarDate } from '../../common/clock/brasilia-time.js';
import { addCalendarDays } from '../../common/domain/business-day.js';
import { brasiliaInstant } from './import-schedule.js';

export type QueueTier = 'NEW' | 'CHANGED' | 'REFRESH';

/** What the queue reads of a stored property. */
export interface QueueCandidate {
  code: string;
  /** Marked available by the last applied list. */
  available: boolean;
  /** At least one active round or none collected yet (BR-004-16): only these are refreshed. */
  active: boolean;
  /** It has a Caixa page link to ask for. */
  hasDetailsUrl: boolean;
  /** The detail page was collected and not dropped since (`fulfilled`). */
  fulfilled: boolean;
  detailsCollectedAt: Date | null;
  /** The Import Run (hex) whose list last changed it; null when none did. */
  lastChangedRunId: string | null;
  /** After this instant a failed page may be asked for again; null when it is not in back-off. */
  detailsRetryAfter: Date | null;
  /** Page failures in a row (BR-004-21); 0 when the last collection succeeded. */
  detailsFailures: number;
}

export interface QueueInput {
  /** The Import Run the pass belongs to (hex): "changed in today's run". */
  runId: string;
  now: Date;
  /** Pages the pass may still collect today (the daily budget minus what earlier passes took). */
  budget: number;
  /** ENRICHMENT_MAX_STALENESS_DAYS. */
  maxStalenessDays: number;
}

export interface QueueEntry {
  code: string;
  tier: QueueTier;
}

/** The first instant of the Brasília day `days` calendar days before `now`'s. */
export function brasiliaDayStartBefore(now: Date, days: number): Date {
  return brasiliaInstant(addCalendarDays(brasiliaCalendarDate(now), -days), 0);
}

/**
 * The instant before which a property's detail data counts as due for a refresh: its Brasília
 * calendar day is `maxStalenessDays` or more days behind today's. A property collected on D is due
 * on D + N (a whole calendar day, however the run's clock time drifts from one day to the next).
 *
 *   now 2026-11-24, N = 7  ->  2026-11-18T00:00 Brasília: data collected before it (on 11-17 or
 *   earlier) is due; data collected on 11-18 is due tomorrow.
 */
export function refreshDueBefore(now: Date, maxStalenessDays: number): Date {
  return brasiliaDayStartBefore(now, maxStalenessDays - 1);
}

function tierOf(candidate: QueueCandidate, input: QueueInput, dueBefore: Date): QueueTier | null {
  if (!candidate.available || !candidate.hasDetailsUrl) return null;
  const retryAfter = candidate.detailsRetryAfter;
  if (retryAfter !== null && retryAfter.getTime() > input.now.getTime()) return null;
  const collectedAt = candidate.detailsCollectedAt;
  if (collectedAt === null || !candidate.fulfilled) return 'NEW';
  // Collected today (this run, an earlier pass of it): nothing more to ask of the page.
  if (collectedAt.getTime() >= brasiliaDayStartBefore(input.now, 0).getTime()) return null;
  if (candidate.lastChangedRunId === input.runId) return 'CHANGED';
  const stale = collectedAt.getTime() < dueBefore.getTime();
  if (candidate.active && (stale || candidate.detailsFailures > 0)) return 'REFRESH';
  return null;
}

const TIER_ORDER: Readonly<Record<QueueTier, number>> = { NEW: 0, CHANGED: 1, REFRESH: 2 };

/**
 * The pages to collect now, in order, at most `input.budget` of them. Deterministic: within NEW and
 * CHANGED by property number, within REFRESH oldest data first, then by number.
 */
export function selectEnrichmentBatch(
  candidates: readonly QueueCandidate[],
  input: QueueInput,
): QueueEntry[] {
  const budget = Math.floor(input.budget);
  if (!(budget > 0)) return [];
  const dueBefore = refreshDueBefore(input.now, input.maxStalenessDays);
  const queued: { entry: QueueEntry; collectedAt: number }[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.code)) continue; // a property is queued once, whichever query found it
    seen.add(candidate.code);
    const tier = tierOf(candidate, input, dueBefore);
    if (tier === null) continue;
    const collectedAt =
      candidate.detailsCollectedAt === null ? 0 : candidate.detailsCollectedAt.getTime();
    queued.push({ entry: { code: candidate.code, tier }, collectedAt });
  }
  queued.sort((a, b) => {
    const byTier = TIER_ORDER[a.entry.tier] - TIER_ORDER[b.entry.tier];
    if (byTier !== 0) return byTier;
    if (a.entry.tier === 'REFRESH' && a.collectedAt !== b.collectedAt) {
      return a.collectedAt - b.collectedAt;
    }
    return a.entry.code < b.entry.code ? -1 : 1; // codes are unique here
  });
  return queued.slice(0, budget).map(({ entry }) => entry);
}
