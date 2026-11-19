// SPEC-012 BR-012-21, BR-012-28 (D-47): the grace period after a lapse. Instants only, in whole
// days of 24 hours (Brasília has no daylight saving time now, and an instant needs no calendar:
// formatting it in Brasília time is the edge's job, BR-012-15).

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The first instant the office is read-only: `lapsedAt` plus the grace days. Worked example with
 * the default 10 days: lapse at 2026-03-01T12:00Z → read-only from 2026-03-11T12:00Z.
 */
export function readOnlyAtOf(lapsedAt: Date, graceDays: number): Date {
  return new Date(lapsedAt.getTime() + graceDays * DAY_MS);
}

/**
 * BR-012-28: read-only once the grace period is over. The grace period is the half-open interval
 * [lapsedAt, lapsedAt + graceDays): at exactly the end the office is already read-only, and a
 * write on day 9 is allowed where one on day 11 is refused.
 */
export function isReadOnly(lapsedAt: Date, now: Date, graceDays: number): boolean {
  return now.getTime() >= readOnlyAtOf(lapsedAt, graceDays).getTime();
}
