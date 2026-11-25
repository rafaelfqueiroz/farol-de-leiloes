// SPEC-004 BR-004-21: what a failed detail page costs. The property keeps its previous detail data
// (or unknown), is left alone for a while and retried in a later run: the wait doubles with every
// failure in a row, up to a bound, so a page that never answers does not eat the daily budget.
// Pure (AR-05): "now" is an argument (AR-24).
import { brasiliaCalendarDate } from '../../common/clock/brasilia-time.js';
import { addCalendarDays } from '../../common/domain/business-day.js';
import { brasiliaInstant } from './import-schedule.js';

/** The longest wait, in days, unless ENRICHMENT_FAILURE_BACKOFF_DAYS itself is larger. */
export const MAX_BACKOFF_DAYS = 16;

/**
 * Days to wait after the `failures`-th failure in a row: `baseDays`, doubling each time, never more
 * than MAX_BACKOFF_DAYS (or `baseDays` if that is larger).
 *
 *   backoffDays(1, 1) -> 1;  backoffDays(1, 4) -> 8;  backoffDays(1, 9) -> 16;  backoffDays(20, 2) -> 20
 */
export function backoffDays(baseDays: number, failures: number): number {
  const doublings = Math.min(Math.max(failures, 1) - 1, 10);
  return Math.min(baseDays * 2 ** doublings, Math.max(baseDays, MAX_BACKOFF_DAYS));
}

/** The first instant (midnight Brasília) the failed page may be asked for again. */
export function retryAfter(now: Date, baseDays: number, failures: number): Date {
  return brasiliaInstant(
    addCalendarDays(brasiliaCalendarDate(now), backoffDays(baseDays, failures)),
    0,
  );
}

/** Failures in a row (BR-004-21) that stop the pass for the run: not a block, not an alert. */
export function stopsThePass(consecutiveFailures: number, limit: number): boolean {
  return consecutiveFailures >= limit;
}
