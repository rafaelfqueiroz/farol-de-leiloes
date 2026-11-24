// SPEC-004 BR-004-01..04, BR-004-10, BR-004-31: the state machine of the daily import as a table of
// hand-computed instants. Brasília is UTC-3 all year (no daylight saving since 2019), so 06:00 in
// Brasília is 09:00Z and 12:00 is 15:00Z. 2026-11-23 is a Monday, 2026-11-21 a Saturday.
import { describe, expect, it } from 'vitest';
import {
  APPLY_FAILED,
  type DayCalendar,
  decideNextAction,
  endOfDay,
  type ImportSchedule,
  isSameRejectedFile,
  LIST_UNREACHABLE,
  nextAttemptDue,
  NO_ATTEMPT,
  NO_NEW_LIST_CODE,
  type RunProgress,
  type RunState,
  cutoffInstant,
  windowStartInstant,
} from './import-schedule.js';

const SCHEDULE: ImportSchedule = {
  windowStartMinutes: 6 * 60,
  cutoffMinutes: 12 * 60,
  maxAttempts: 12,
  attemptSpacingMinutes: 30,
};

const MONDAY = '2026-11-23';
const SATURDAY = '2026-11-21';
const HOLIDAY = '2026-12-25'; // a Friday
const holidays = new Set([HOLIDAY]);

const calendar: DayCalendar = {
  isBusinessDay: (date) => {
    const weekend = new Date(`${date}T12:00:00Z`).getUTCDay() % 6 === 0;
    return !weekend && !holidays.has(date);
  },
  nonBusinessReason: (date) => {
    if (new Date(`${date}T12:00:00Z`).getUTCDay() % 6 === 0) return 'WEEKEND';
    return holidays.has(date) ? 'HOLIDAY' : null;
  },
};

const at = (iso: string) => new Date(iso);
const NONE: RunProgress = {
  listReached: false,
  applying: false,
  applyFailed: false,
  rejection: null,
};

function run(overrides: Partial<RunState> = {}, progress: Partial<RunProgress> = {}): RunState {
  return {
    brasiliaDate: MONDAY,
    outcome: 'RUNNING',
    attempts: 1,
    nextAttemptAt: null,
    updateCompletedAt: null,
    progress: { ...NONE, ...progress },
    ...overrides,
  };
}

const decide = (now: string, state: RunState | null, date = MONDAY) =>
  decideNextAction({ brasiliaDate: date, run: state }, at(now), SCHEDULE, calendar);

describe('the window of a day (BR-004-01, BR-004-03)', () => {
  it("opens at 06:00 and closes at 12:00 Brasília, the date's own, whatever the host zone", () => {
    expect(windowStartInstant(MONDAY, SCHEDULE).toISOString()).toBe('2026-11-23T09:00:00.000Z');
    expect(cutoffInstant(MONDAY, SCHEDULE).toISOString()).toBe('2026-11-23T15:00:00.000Z');
  });

  it('rejects a day that is not a real calendar date', () => {
    expect(() => windowStartInstant('2026-02-30', SCHEDULE)).toThrow(RangeError);
  });
});

describe('a day with no run yet', () => {
  it.each([
    ['one millisecond before the window start', '2026-11-23T08:59:59.999Z', 'BEFORE_WINDOW'],
    ['midnight Brasília', '2026-11-23T03:00:00.000Z', 'BEFORE_WINDOW'],
  ])('waits %s', (_name, now, reason) => {
    expect(decide(now, null)).toEqual({ kind: 'wait', reason });
  });

  it.each([
    ['exactly the window start', '2026-11-23T09:00:00.000Z'],
    ['mid-morning', '2026-11-23T12:07:00.000Z'],
    ['one millisecond before the cutoff', '2026-11-23T14:59:59.999Z'],
  ])('attempts at %s', (_name, now) => {
    expect(decide(now, null)).toEqual({ kind: 'attempt', mode: 'search' });
  });

  it.each([
    ['exactly the cutoff', '2026-11-23T15:00:00.000Z'],
    ['the evening', '2026-11-24T01:00:00.000Z'],
  ])(
    'decides a business day nobody attempted as FAILED NO_ATTEMPT at %s (BR-004-03)',
    (_name, now) => {
      expect(decide(now, null)).toEqual({
        kind: 'finalize',
        outcome: 'FAILED',
        reason: NO_ATTEMPT,
        nonBusinessReason: null,
      });
    },
  );

  it.each([
    ['a Saturday', SATURDAY, '2026-11-21T15:00:00.000Z'],
    ['a holiday', HOLIDAY, '2026-12-25T15:00:00.000Z'],
  ])('leaves %s nobody attempted alone: nothing was expected', (_name, day, now) => {
    expect(decide(now, null, day)).toEqual({ kind: 'wait', reason: 'AFTER_CUTOFF' });
  });
});

describe('spacing and attempts (BR-004-02)', () => {
  const due = at('2026-11-23T09:30:00.000Z');

  it('waits until nextAttemptAt, and attempts at that instant', () => {
    const state = run({ nextAttemptAt: due, attempts: 1 }, { listReached: true });
    expect(decide('2026-11-23T09:29:59.999Z', state)).toEqual({ kind: 'wait', reason: 'SPACING' });
    expect(decide('2026-11-23T09:30:00.000Z', state)).toEqual({ kind: 'attempt', mode: 'search' });
  });

  it('attempts when no next attempt is scheduled (the first attempt crashed before it was)', () => {
    expect(decide('2026-11-23T09:05:00.000Z', run({ nextAttemptAt: null }))).toEqual({
      kind: 'attempt',
      mode: 'search',
    });
  });

  it('allows the last attempt before the cutoff and decides the day at the cutoff', () => {
    const state = run(
      { attempts: 5, nextAttemptAt: at('2026-11-23T14:59:00.000Z') },
      { listReached: true },
    );
    expect(decide('2026-11-23T14:59:59.999Z', state)).toEqual({ kind: 'attempt', mode: 'search' });
    expect(decide('2026-11-23T15:00:00.000Z', state)).toMatchObject({
      kind: 'finalize',
      outcome: 'NO_NEW_LIST',
    });
  });

  it('waits before the window opens even for a run that exists (a forced attempt, a moved window)', () => {
    expect(decide('2026-11-23T08:00:00.000Z', run())).toEqual({
      kind: 'wait',
      reason: 'BEFORE_WINDOW',
    });
  });

  it('stops attempting when the attempts are used up and waits for the cutoff on a quiet day', () => {
    const state = run({ attempts: 12 }, { listReached: true });
    expect(decide('2026-11-23T14:00:00.000Z', state)).toEqual({
      kind: 'wait',
      reason: 'ATTEMPTS_EXHAUSTED',
    });
    expect(decide('2026-11-23T15:00:00.000Z', state)).toMatchObject({ outcome: 'NO_NEW_LIST' });
  });

  it('one attempt short of the maximum still attempts', () => {
    expect(decide('2026-11-23T14:00:00.000Z', run({ attempts: 11 }))).toEqual({
      kind: 'attempt',
      mode: 'search',
    });
  });

  it('decides a day that cannot be reached as soon as the attempts are used up', () => {
    expect(decide('2026-11-23T14:00:00.000Z', run({ attempts: 12 }))).toEqual({
      kind: 'finalize',
      outcome: 'FAILED',
      reason: LIST_UNREACHABLE,
      nonBusinessReason: null,
    });
  });

  it('decides a rejected day as soon as the attempts are used up', () => {
    const rejection = { generatedOn: '2026-11-23', reason: 'TRUNCATED_LIST' };
    expect(
      decide('2026-11-23T14:00:00.000Z', run({ attempts: 12 }, { listReached: true, rejection })),
    ).toEqual({
      kind: 'finalize',
      outcome: 'REJECTED_LIST',
      reason: 'TRUNCATED_LIST',
      nonBusinessReason: null,
    });
  });
});

describe('the outcome of a day that applied nothing (BR-004-03, BR-004-10)', () => {
  const outcomeOf = (date: string, state: Partial<RunState>, progress: Partial<RunProgress>) =>
    endOfDay(
      { brasiliaDate: date, attempts: 3, progress: { ...NONE, ...progress }, ...state },
      calendar,
    );

  it('business day, Caixa still served the applied list: NO_NEW_LIST, a failure', () => {
    expect(outcomeOf(MONDAY, {}, { listReached: true })).toEqual({
      kind: 'finalize',
      outcome: 'NO_NEW_LIST',
      reason: NO_NEW_LIST_CODE,
      nonBusinessReason: null,
    });
  });

  it('Saturday: NO_UPDATE, not a failure, with the reason WEEKEND', () => {
    expect(outcomeOf(SATURDAY, {}, { listReached: true })).toMatchObject({
      outcome: 'NO_UPDATE',
      nonBusinessReason: 'WEEKEND',
    });
  });

  it('a configured holiday: NO_UPDATE with the reason HOLIDAY', () => {
    expect(outcomeOf(HOLIDAY, {}, { listReached: true })).toMatchObject({
      outcome: 'NO_UPDATE',
      nonBusinessReason: 'HOLIDAY',
    });
  });

  it('nothing reached on a weekend is a failure, not a quiet day (BR-004-03)', () => {
    expect(outcomeOf(SATURDAY, {}, {})).toMatchObject({
      outcome: 'FAILED',
      reason: LIST_UNREACHABLE,
    });
  });

  it('a day decided with no attempt counted is FAILED NO_ATTEMPT', () => {
    expect(outcomeOf(MONDAY, { attempts: 0 }, {})).toMatchObject({
      outcome: 'FAILED',
      reason: NO_ATTEMPT,
    });
  });

  it('a refused list on a weekend is REJECTED_LIST, an alert day (BR-004-04)', () => {
    const rejection = { generatedOn: '2026-11-21', reason: 'UNRECOGNISED_LAYOUT' };
    expect(outcomeOf(SATURDAY, {}, { listReached: true, rejection })).toMatchObject({
      outcome: 'REJECTED_LIST',
      reason: 'UNRECOGNISED_LAYOUT',
    });
  });

  it('a refusal outranks a later "not new" and an unreachable attempt', () => {
    const rejection = { generatedOn: null, reason: 'NO_GENERATION_DATE' };
    expect(outcomeOf(MONDAY, {}, { listReached: true, rejection }).outcome).toBe('REJECTED_LIST');
    expect(outcomeOf(MONDAY, {}, { rejection }).outcome).toBe('REJECTED_LIST');
  });

  it('a validated list that could not be applied is FAILED, ahead of everything else', () => {
    const rejection = { generatedOn: null, reason: 'NO_GENERATION_DATE' };
    expect(
      outcomeOf(MONDAY, {}, { applyFailed: true, listReached: true, rejection }),
    ).toMatchObject({
      outcome: 'FAILED',
      reason: APPLY_FAILED,
    });
  });

  it('is decided at the cutoff of a weekend by the same function', () => {
    const saturday = run({ brasiliaDate: SATURDAY, attempts: 4 }, { listReached: true });
    expect(decide('2026-11-21T14:59:59.999Z', saturday, SATURDAY)).toEqual({
      kind: 'attempt',
      mode: 'search',
    });
    expect(decide('2026-11-21T15:00:00.000Z', saturday, SATURDAY)).toMatchObject({
      kind: 'finalize',
      outcome: 'NO_UPDATE',
    });
  });
});

describe('a run that crosses midnight keeps its date (BR-004-27)', () => {
  it('is decided by its own cutoff once the clock is on the next day', () => {
    const state = run({ attempts: 3 }, { listReached: true });
    // 00:30 Brasília on Tuesday, Monday's run still open: Monday's cutoff has long passed.
    expect(decide('2026-11-24T03:30:00.000Z', state, MONDAY)).toMatchObject({
      kind: 'finalize',
      outcome: 'NO_NEW_LIST',
    });
  });

  it('a list being applied when the day ends is an apply that failed: decided FAILED APPLY_FAILED', () => {
    expect(decide('2026-11-24T03:30:00.000Z', run({}, { applying: true }), MONDAY)).toEqual({
      kind: 'finalize',
      outcome: 'FAILED',
      reason: APPLY_FAILED,
      nonBusinessReason: null,
    });
  });

  it('the new day has its own window: nothing before 06:00 of Tuesday', () => {
    expect(decide('2026-11-24T03:30:00.000Z', null, '2026-11-24')).toEqual({
      kind: 'wait',
      reason: 'BEFORE_WINDOW',
    });
  });
});

describe('a list being applied is resumed like any attempt (BR-004-07, SC-24)', () => {
  const applying = { applying: true };

  it('resumes from the stored copy once the spacing has passed, and not before', () => {
    const state = run({ attempts: 1, nextAttemptAt: at('2026-11-23T09:30:00.000Z') }, applying);
    expect(decide('2026-11-23T09:29:59.999Z', state)).toEqual({ kind: 'wait', reason: 'SPACING' });
    expect(decide('2026-11-23T09:30:00.000Z', state)).toEqual({ kind: 'attempt', mode: 'resume' });
  });

  it('is not resumed past the cutoff: the day is decided FAILED APPLY_FAILED', () => {
    expect(decide('2026-11-23T15:00:00.000Z', run({ attempts: 3 }, applying))).toMatchObject({
      kind: 'finalize',
      outcome: 'FAILED',
      reason: APPLY_FAILED,
    });
    expect(decide('2026-11-23T14:59:59.999Z', run({ attempts: 3 }, applying))).toEqual({
      kind: 'attempt',
      mode: 'resume',
    });
  });

  it('is not resumed with the attempts used up: decided at once', () => {
    expect(decide('2026-11-23T10:00:00.000Z', run({ attempts: 12 }, applying))).toMatchObject({
      kind: 'finalize',
      outcome: 'FAILED',
      reason: APPLY_FAILED,
    });
  });
});

describe('a run that applied its list (BR-004-23)', () => {
  const success = run({ outcome: 'SUCCESS', attempts: 2 });

  it('completes the update until updateCompletedAt is set, whatever the clock says', () => {
    expect(decide('2026-11-23T10:00:00.000Z', success)).toEqual({ kind: 'collect' });
    expect(decide('2026-11-24T10:00:00.000Z', success)).toEqual({ kind: 'collect' });
  });

  it('does nothing once the update is complete', () => {
    expect(
      decide('2026-11-23T10:00:00.000Z', {
        ...success,
        updateCompletedAt: at('2026-11-23T09:40:00.000Z'),
      }),
    ).toEqual({ kind: 'wait', reason: 'FINISHED' });
  });
});

describe('a decided day is final (BR-004-10)', () => {
  it.each(['FAILED', 'REJECTED_LIST', 'NO_NEW_LIST', 'NO_UPDATE'] as const)(
    '%s does nothing, even with the window open and the attempts left',
    (outcome) => {
      expect(decide('2026-11-23T10:00:00.000Z', run({ outcome, attempts: 1 }))).toEqual({
        kind: 'wait',
        reason: 'FINISHED',
      });
    },
  );
});

describe('helpers', () => {
  it("nextAttemptDue is the attempt's minute plus the spacing", () => {
    expect(nextAttemptDue(at('2026-11-23T09:00:00.003Z'), 30).toISOString()).toBe(
      '2026-11-23T09:30:00.000Z',
    );
    expect(nextAttemptDue(at('2026-11-23T09:05:42.500Z'), 30).toISOString()).toBe(
      '2026-11-23T09:35:00.000Z',
    );
  });

  it('isSameRejectedFile compares generation days, and two unreadable files are the same', () => {
    const rejection = { generatedOn: '2026-11-23', reason: 'TRUNCATED_LIST' };
    expect(isSameRejectedFile(rejection, '2026-11-23')).toBe(true);
    expect(isSameRejectedFile(rejection, '2026-11-24')).toBe(false);
    expect(isSameRejectedFile(null, '2026-11-23')).toBe(false);
    expect(isSameRejectedFile({ generatedOn: null, reason: 'UNRECOGNISED_LAYOUT' }, null)).toBe(
      true,
    );
  });
});
