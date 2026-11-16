// SPEC-003 BR-003-03 and its acceptance criterion: "a maintenance window announced 47 hours ahead
// counts as downtime; one announced 48 hours ahead does not. Overrunning the announced end counts
// as downtime from the announced end." Times are hand-written instants (TS-04, TS-06); the
// arithmetic is in the comments.
import { describe, expect, it } from 'vitest';
import {
  announcedInTime,
  countsAsExcluded,
  invalidWindowFields,
  isExcludedAt,
  isUpcomingOrInProgress,
  maintenancePhase,
  MIN_NOTICE_HOURS,
  UPCOMING_HORIZON_DAYS,
  upcomingBounds,
  type MaintenanceWindow,
} from './maintenance-window.js';

const START = new Date('2026-03-10T05:00:00.000Z'); // 02:00 in Brasília
const END = new Date('2026-03-10T07:00:00.000Z');

/** A window announced `hours` before START, ending at END. */
function announcedAhead(hours: number): MaintenanceWindow {
  return {
    startsAt: START,
    endsAt: END,
    announcedAt: new Date(START.getTime() - hours * 60 * 60 * 1000),
  };
}

describe('BR-003-03: announced in time', () => {
  it('requires 48 hours of notice', () => {
    expect(MIN_NOTICE_HOURS).toBe(48);
  });

  it('BR-003-03: 47 h ahead is not in time and counts as downtime', () => {
    // 2026-03-08T06:00Z -> 2026-03-10T05:00Z = 47 h
    expect(announcedInTime(announcedAhead(47))).toBe(false);
    expect(countsAsExcluded(announcedAhead(47))).toBe(false);
  });

  it('BR-003-03: 47 h 59 min 59 s ahead is still not in time', () => {
    const window: MaintenanceWindow = {
      ...announcedAhead(48),
      announcedAt: new Date(START.getTime() - (48 * 3600 - 1) * 1000), // 48 h minus 1 s
    };
    expect(announcedInTime(window)).toBe(false);
  });

  it('BR-003-03: exactly 48 h ahead is in time and is excluded', () => {
    // 2026-03-08T05:00Z -> 2026-03-10T05:00Z = 48 h
    expect(announcedInTime(announcedAhead(48))).toBe(true);
    expect(countsAsExcluded(announcedAhead(48))).toBe(true);
  });

  it('BR-003-03: 7 days ahead is in time', () => {
    expect(announcedInTime(announcedAhead(7 * 24))).toBe(true);
  });

  it('BR-003-03: announced after it started is not in time', () => {
    expect(announcedInTime(announcedAhead(-1))).toBe(false);
  });
});

describe('BR-003-03: downtime inside and past the window', () => {
  it('excludes the whole announced interval, start inclusive', () => {
    const window = announcedAhead(48);
    expect(isExcludedAt(window, START)).toBe(true);
    expect(isExcludedAt(window, new Date('2026-03-10T06:00:00.000Z'))).toBe(true);
    expect(isExcludedAt(window, new Date(END.getTime() - 1))).toBe(true);
  });

  it('counts the minute before the start as downtime', () => {
    expect(isExcludedAt(announcedAhead(48), new Date(START.getTime() - 1))).toBe(false);
  });

  it('BR-003-03: overrunning the announced end is downtime from the announced end', () => {
    const window = announcedAhead(48);
    expect(isExcludedAt(window, END)).toBe(false); // the announced end instant itself
    expect(isExcludedAt(window, new Date('2026-03-10T07:01:00.000Z'))).toBe(false);
    expect(isExcludedAt(window, new Date('2026-03-10T09:00:00.000Z'))).toBe(false);
  });

  it('BR-003-03: a window announced 47 h ahead excludes nothing, even inside its interval', () => {
    expect(isExcludedAt(announcedAhead(47), new Date('2026-03-10T06:00:00.000Z'))).toBe(false);
  });
});

describe('maintenancePhase', () => {
  const window = announcedAhead(48);

  it('is upcoming before the start', () => {
    expect(maintenancePhase(window, new Date(START.getTime() - 1))).toBe('upcoming');
  });

  it('is in progress from the start until the announced end', () => {
    expect(maintenancePhase(window, START)).toBe('in_progress');
    expect(maintenancePhase(window, new Date(END.getTime() - 1))).toBe('in_progress');
  });

  it('is finished from the announced end on', () => {
    expect(maintenancePhase(window, END)).toBe('finished');
  });
});

describe('the public banner window', () => {
  const now = new Date('2026-03-01T12:00:00.000Z');

  it('looks 14 days ahead', () => {
    expect(UPCOMING_HORIZON_DAYS).toBe(14);
    // 2026-03-01T12:00Z + 14 d = 2026-03-15T12:00Z
    expect(upcomingBounds(now)).toEqual({
      endsAfter: now,
      startsBy: new Date('2026-03-15T12:00:00.000Z'),
    });
  });

  const window = (startsAt: string, endsAt: string): MaintenanceWindow => ({
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    announcedAt: new Date('2026-02-01T00:00:00.000Z'),
  });

  it('includes a window starting exactly at the horizon', () => {
    expect(
      isUpcomingOrInProgress(window('2026-03-15T12:00:00.000Z', '2026-03-15T14:00:00.000Z'), now),
    ).toBe(true);
  });

  it('excludes a window starting after the horizon', () => {
    expect(
      isUpcomingOrInProgress(window('2026-03-15T12:00:01.000Z', '2026-03-15T14:00:00.000Z'), now),
    ).toBe(false);
  });

  it('includes a window in progress', () => {
    expect(
      isUpcomingOrInProgress(window('2026-03-01T11:00:00.000Z', '2026-03-01T13:00:00.000Z'), now),
    ).toBe(true);
  });

  it('excludes a window that ended, the end instant included', () => {
    expect(
      isUpcomingOrInProgress(window('2026-03-01T10:00:00.000Z', '2026-03-01T12:00:00.000Z'), now),
    ).toBe(false);
  });
});

describe('invalidWindowFields', () => {
  const now = new Date('2026-03-01T12:00:00.000Z');
  const later = new Date('2026-03-01T13:00:00.000Z');

  it('accepts a window that starts in the future and ends after it starts', () => {
    expect(
      invalidWindowFields({ startsAt: later, endsAt: new Date(later.getTime() + 1) }, now),
    ).toEqual([]);
  });

  it('rejects a start that is now or in the past', () => {
    expect(invalidWindowFields({ startsAt: now, endsAt: later }, now)).toEqual(['startsAt']);
  });

  it('rejects an end that is not after the start', () => {
    expect(invalidWindowFields({ startsAt: later, endsAt: later }, now)).toEqual(['endsAt']);
    expect(
      invalidWindowFields({ startsAt: later, endsAt: new Date(later.getTime() - 1) }, now),
    ).toEqual(['endsAt']);
  });

  it('reports both when both are wrong', () => {
    expect(
      invalidWindowFields(
        { startsAt: new Date(now.getTime() - 2), endsAt: new Date(now.getTime() - 3) },
        now,
      ),
    ).toEqual(['startsAt', 'endsAt']);
  });

  it('rejects an invalid date', () => {
    expect(invalidWindowFields({ startsAt: new Date('nope'), endsAt: later }, now)).toEqual([
      'startsAt',
      'endsAt',
    ]);
  });
});
