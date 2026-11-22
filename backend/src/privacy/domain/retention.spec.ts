// SPEC-010 BR-010-18..19, BR-010-24: the retention clock, with expectations worked out by hand
// (TS-04) at the boundaries that matter (TS-11): the anniversary day itself, 29 February, month ends,
// the change of year and the setting moving from 5 to 6 years with no code change.
import { describe, expect, it } from 'vitest';
import {
  CLOSED_KINDS,
  closedOnCutoff,
  closingProblem,
  EARLIEST_CLOSED_ON,
  InvalidRetentionInputError,
  isDueForPurge,
  lastDayKept,
  retentionReview,
  UNVALIDATED_RUN_CAP,
} from './retention.js';

describe('lastDayKept (BR-010-19): the Nth anniversary of the closing date', () => {
  it.each<[string, string, number, string]>([
    // A plain date: 15/03/2027 + 5 years = 15/03/2032.
    ['an ordinary date', '2027-03-15', 5, '2032-03-15'],
    // 29/02/2028 + 5 = 2033, a common year with no 29 February: the last day of February, the 28th.
    ['29 February into a common year', '2028-02-29', 5, '2033-02-28'],
    // 29/02/2028 + 4 = 2032, a leap year again: the 29th exists and stays.
    ['29 February into a leap year', '2028-02-29', 4, '2032-02-29'],
    // 29/02/2028 + 8 = 2036, leap (divisible by 4, not a century year).
    ['29 February eight years on', '2028-02-29', 8, '2036-02-29'],
    // 29/02/2096 + 4 = 2100: a century year not divisible by 400 is NOT leap, so 28 February.
    ['29 February into 2100', '2096-02-29', 4, '2100-02-28'],
    // 29/02/2096 + 304 = 2400, divisible by 400, so leap again: the 29th stays.
    ['29 February into a year divisible by 400', '2096-02-29', 304, '2400-02-29'],
    // 28 February never moves: 28/02/2027 + 5 = 28/02/2032 (2032 is leap, the 28th is not its end).
    ['28 February', '2027-02-28', 5, '2032-02-28'],
    // 31/01 + 1 year: January has 31 days in every year.
    ['31 January', '2027-01-31', 1, '2028-01-31'],
    // 30 April stays 30 April; 31 December stays 31 December (the year changes, the day does not).
    ['30 April', '2027-04-30', 5, '2032-04-30'],
    ['31 December', '2027-12-31', 5, '2032-12-31'],
    // 1 January closing: 01/01/2027 + 5 = 01/01/2032.
    ['1 January', '2027-01-01', 5, '2032-01-01'],
  ])('%s: %s + %i years -> %s', (_label, closedOn, years, expected) => {
    expect(lastDayKept(closedOn, years)).toBe(expected);
  });

  it('moves every date by exactly one more year when the setting goes from 5 to 6 (BR-010-24)', () => {
    for (const closedOn of ['2027-03-15', '2027-12-31', '2027-01-01', '2028-02-29', '2027-02-28']) {
      const five = lastDayKept(closedOn, 5);
      const six = lastDayKept(closedOn, 6);
      expect(Number(six.slice(0, 4)) - Number(five.slice(0, 4))).toBe(1);
    }
    // Hand-computed: 15/03/2032 -> 15/03/2033; 29/02/2028 -> 28/02/2033 -> 28/02/2034.
    expect(lastDayKept('2027-03-15', 6)).toBe('2033-03-15');
    expect(lastDayKept('2028-02-29', 6)).toBe('2034-02-28');
  });
});

describe('isDueForPurge (BR-010-19): kept through the anniversary, gone from the next day', () => {
  it('15/03/2027: present on 15/03/2032, gone on 16/03/2032', () => {
    expect(isDueForPurge('2032-03-14', '2027-03-15', 5)).toBe(false);
    expect(isDueForPurge('2032-03-15', '2027-03-15', 5)).toBe(false);
    expect(isDueForPurge('2032-03-16', '2027-03-15', 5)).toBe(true);
  });

  it('29/02/2028: present on 28/02/2033, gone on 01/03/2033', () => {
    expect(isDueForPurge('2033-02-27', '2028-02-29', 5)).toBe(false);
    expect(isDueForPurge('2033-02-28', '2028-02-29', 5)).toBe(false);
    expect(isDueForPurge('2033-03-01', '2028-02-29', 5)).toBe(true);
  });

  it('29/02/2028 with 4 years: present on 29/02/2032, gone on 01/03/2032', () => {
    expect(isDueForPurge('2032-02-29', '2028-02-29', 4)).toBe(false);
    expect(isDueForPurge('2032-03-01', '2028-02-29', 4)).toBe(true);
  });

  it('the year change: 31/12/2027 is kept through 31/12/2032 and gone on 01/01/2033', () => {
    expect(isDueForPurge('2032-12-31', '2027-12-31', 5)).toBe(false);
    expect(isDueForPurge('2033-01-01', '2027-12-31', 5)).toBe(true);
  });

  it('a journey is never due before its anniversary, however early', () => {
    expect(isDueForPurge('2027-03-15', '2027-03-15', 5)).toBe(false);
    expect(isDueForPurge('2020-01-01', '2027-03-15', 5)).toBe(false);
  });

  it('changing the setting from 5 to 6 moves the deletion day by a year, no other change', () => {
    // 15/03/2027: with 5 years gone on 16/03/2032; with 6 years still present then, gone 16/03/2033.
    expect(isDueForPurge('2032-03-16', '2027-03-15', 5)).toBe(true);
    expect(isDueForPurge('2032-03-16', '2027-03-15', 6)).toBe(false);
    expect(isDueForPurge('2033-03-15', '2027-03-15', 6)).toBe(false);
    expect(isDueForPurge('2033-03-16', '2027-03-15', 6)).toBe(true);
  });
});

describe('closedOnCutoff: the closing date at or before which a journey can be due today', () => {
  it.each<[string, number, string]>([
    // 16/03/2032 - 5 years = 16/03/2027: 15/03/2027 (due) is at or before it; 16/03/2027 is not due
    // (kept through 16/03/2032 itself) and is caught by the re-check.
    ['2032-03-16', 5, '2027-03-16'],
    // 01/03/2033 - 5 = 01/03/2028: includes 29/02/2028, due that day.
    ['2033-03-01', 5, '2028-03-01'],
    // 28/02/2033 - 5 = 28/02/2028: 29/02/2028 is after it, and is NOT due yet (kept through 28/02/2033).
    ['2033-02-28', 5, '2028-02-28'],
    // 29/02/2032 - 5 = 29/02/2027 does not exist: the 28th.
    ['2032-02-29', 5, '2027-02-28'],
  ])('%s minus %i years -> %s', (today, years, expected) => {
    expect(closedOnCutoff(today, years)).toBe(expected);
  });

  it('never leaves out a journey that is due (every closing day of 2027-2028 against every day of 2031-2034, 4 and 5 years)', () => {
    const days = (from: string, to: string): string[] => {
      const out: string[] = [];
      for (
        let at = new Date(`${from}T00:00:00Z`);
        at <= new Date(`${to}T00:00:00Z`);
        at = new Date(at.getTime() + 86_400_000)
      ) {
        out.push(at.toISOString().slice(0, 10));
      }
      return out;
    };
    const closings = days('2027-01-01', '2028-12-31');
    const todays = days('2031-01-01', '2034-12-31');
    const missed: string[] = [];
    let due = 0;
    for (const years of [4, 5]) {
      for (const today of todays) {
        const cutoff = closedOnCutoff(today, years);
        for (const closedOn of closings) {
          if (!isDueForPurge(today, closedOn, years)) continue;
          due += 1;
          if (closedOn > cutoff) missed.push(`${closedOn} due on ${today} (${years}y)`);
        }
      }
    }
    expect(missed).toEqual([]);
    expect(due).toBeGreaterThan(1000);
  });
});

describe('validation: a malformed or impossible input is refused with a typed error', () => {
  it.each([
    ['an empty string', ''],
    ['a date with a time', '2027-03-15T00:00:00Z'],
    ['day-first text', '15/03/2027'],
    ['a one-digit month', '2027-3-15'],
    ['month 13', '2027-13-01'],
    ['month 0', '2027-00-10'],
    ['day 0', '2027-03-00'],
    ['31 April', '2027-04-31'],
    ['29 February in a common year', '2027-02-29'],
    ['29 February in a century common year', '2100-02-29'],
    ['32 January', '2027-01-32'],
  ])('refuses %s', (_label, bad) => {
    expect(() => lastDayKept(bad, 5)).toThrow(InvalidRetentionInputError);
    expect(() => isDueForPurge('2030-01-01', bad, 5)).toThrow(InvalidRetentionInputError);
    expect(() => isDueForPurge(bad, '2027-03-15', 5)).toThrow(InvalidRetentionInputError);
    expect(() => closedOnCutoff(bad, 5)).toThrow(InvalidRetentionInputError);
  });

  it('accepts 29 February in a year divisible by 400', () => {
    expect(lastDayKept('2000-02-29', 4)).toBe('2004-02-29');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s as a retention period',
    (years) => {
      expect(() => lastDayKept('2027-03-15', years)).toThrow(InvalidRetentionInputError);
      expect(() => closedOnCutoff('2032-03-15', years)).toThrow(InvalidRetentionInputError);
    },
  );

  it('refuses a result outside the years 0001-9999 (it could not be compared as text)', () => {
    expect(() => lastDayKept('9998-06-01', 5)).toThrow(InvalidRetentionInputError);
    expect(() => closedOnCutoff('0003-06-01', 5)).toThrow(InvalidRetentionInputError);
    expect(lastDayKept('9990-06-01', 9)).toBe('9999-06-01');
  });

  it('names the error class, so a job record keeps a stable code', () => {
    expect(new InvalidRetentionInputError('x').name).toBe('InvalidRetentionInputError');
  });
});

describe('closingProblem: a candidate outside the contract is never purged', () => {
  const TODAY = '2032-03-16';

  it('accepts every kind with a date from the floor to today', () => {
    for (const kind of CLOSED_KINDS) {
      expect(closingProblem('2027-03-15', kind, TODAY)).toBeNull();
    }
    // The floor and today themselves are inside.
    expect(closingProblem(EARLIEST_CLOSED_ON, 'won', TODAY)).toBeNull();
    expect(closingProblem(TODAY, 'lost', TODAY)).toBeNull();
  });

  it.each(['', 'open', 'in_progress', 'WON', 'won '])('refuses the kind %j', (kind) => {
    expect(closingProblem('2027-03-15', kind, TODAY)).toBe('unknown-kind');
  });

  it.each(['0000-01-01', '1970-01-01', '2019-12-31'])(
    'refuses %s: before the floor',
    (closedOn) => {
      expect(closingProblem(closedOn, 'won', TODAY)).toBe('before-floor');
    },
  );

  it('refuses a date after today, even by a day', () => {
    expect(closingProblem('2032-03-17', 'won', TODAY)).toBe('in-the-future');
    expect(closingProblem('2999-01-01', 'cancelled', TODAY)).toBe('in-the-future');
  });

  it('refuses a malformed date or a malformed today with the typed error', () => {
    expect(() => closingProblem('15/03/2027', 'won', TODAY)).toThrow(InvalidRetentionInputError);
    expect(() => closingProblem('2027-03-15', 'won', 'today')).toThrow(InvalidRetentionInputError);
  });
});

describe('retentionReview: lowering the period is braked, raising is not', () => {
  it('is provisional without any validation', () => {
    expect(retentionReview(5, undefined)).toBe('provisional');
  });

  it('is lowered when the setting is shorter than the period the lawyer reviewed', () => {
    expect(retentionReview(5, 6)).toBe('lowered');
  });

  it('is validated when the setting equals, exceeds or the validation noted no period', () => {
    expect(retentionReview(5, 5)).toBe('validated');
    expect(retentionReview(6, 5)).toBe('validated');
    expect(retentionReview(5, null)).toBe('validated');
  });

  it('caps an unvalidated run at a small number of journeys', () => {
    expect(UNVALIDATED_RUN_CAP).toBe(25);
  });
});
