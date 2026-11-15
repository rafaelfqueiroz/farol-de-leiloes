// SPEC-003 BR-003-03: when scheduled maintenance is left out of the availability figure. Pure
// rules over plain values (AR-05): no framework, and the time is an argument (AR-24).
//
// A window is announced in the product at `announcedAt`, for the interval [startsAt, endsAt) in
// UTC instants (AR-22; the product shows them in Brasília time, BR-003-23). It is excluded from
// the monthly availability only when announced at least 48 hours ahead. Anything else, an
// unannounced outage, a window announced too late or the stretch past the announced end, is
// downtime (BR-003-01, DL-003-03).

/** BR-003-03: the minimum notice, inside the product, for maintenance to count as excluded. */
export const MIN_NOTICE_HOURS = 48;

/** How far ahead the public banner looks for maintenance (a window in progress always shows). */
export const UPCOMING_HORIZON_DAYS = 14;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface MaintenanceWindow {
  startsAt: Date;
  endsAt: Date;
  /** Set by the server from its Clock when the window is created, never by the caller. */
  announcedAt: Date;
}

export type MaintenancePhase = 'upcoming' | 'in_progress' | 'finished';

/**
 * BR-003-03: announced at least 48 h before it starts. Exactly 48 h counts (">="): 47 h 59 min
 * does not. A window announced too late is still allowed (DL-003-03: urgent security patches)
 * and is shown to users, but it counts as downtime.
 */
export function announcedInTime(window: MaintenanceWindow): boolean {
  return window.startsAt.getTime() - window.announcedAt.getTime() >= MIN_NOTICE_HOURS * HOUR_MS;
}

/** BR-003-03 as the availability report reads it: the window as a whole is left out of downtime. */
export const countsAsExcluded = announcedInTime;

/**
 * Whether downtime at `at` is excluded by this window (BR-003-03): only inside the announced
 * interval, and only when the window was announced in time. The announced end is exclusive and
 * nothing is extended, so an overrun is downtime from the announced end on, whatever the actual
 * end is.
 */
export function isExcludedAt(window: MaintenanceWindow, at: Date): boolean {
  if (!countsAsExcluded(window)) return false;
  const instant = at.getTime();
  return instant >= window.startsAt.getTime() && instant < window.endsAt.getTime();
}

export function maintenancePhase(window: MaintenanceWindow, now: Date): MaintenancePhase {
  if (now.getTime() < window.startsAt.getTime()) return 'upcoming';
  if (now.getTime() < window.endsAt.getTime()) return 'in_progress';
  return 'finished';
}

/** What the public banner lists: windows ending after `endsAfter` that start by `startsBy`. */
export interface UpcomingBounds {
  endsAfter: Date;
  startsBy: Date;
}

export function upcomingBounds(now: Date): UpcomingBounds {
  return { endsAfter: now, startsBy: new Date(now.getTime() + UPCOMING_HORIZON_DAYS * DAY_MS) };
}

export function isUpcomingOrInProgress(window: MaintenanceWindow, now: Date): boolean {
  const { endsAfter, startsBy } = upcomingBounds(now);
  return window.endsAt.getTime() > endsAfter.getTime() && window.startsAt <= startsBy;
}

export interface WindowDraft {
  startsAt: Date;
  endsAt: Date;
}

/**
 * The fields of a new window that cannot be accepted, for VALIDATION_FAILED's `fields` (AR-40:
 * names only): it must start in the future, and end after it starts. An invalid date (NaN)
 * fails every comparison, so it is reported rather than slipping through.
 */
export function invalidWindowFields(draft: WindowDraft, now: Date): string[] {
  const fields: string[] = [];
  const startsAt = draft.startsAt.getTime();
  const endsAt = draft.endsAt.getTime();
  if (!(startsAt > now.getTime())) fields.push('startsAt');
  if (!(endsAt > startsAt)) fields.push('endsAt');
  return fields;
}
