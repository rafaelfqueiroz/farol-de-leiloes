import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  hasHolidaysInYear,
  isBusinessDay,
  isCalendarDate,
  isWeekend,
  parseCalendarDate,
  yearOf,
} from './business-day.js';

const NONE: ReadonlySet<string> = new Set();

describe('parseCalendarDate / isCalendarDate', () => {
  it('reads the parts of a real day', () => {
    expect(parseCalendarDate('2026-11-23')).toEqual({ year: 2026, month: 11, day: 23 });
  });

  it('accepts 29 February only in a leap year', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-01-00'])(
    'refuses the impossible day %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );

  it.each([
    '',
    '2026-2-3',
    '26-02-03',
    '2026/02/03',
    '03/02/2026',
    ' 2026-02-03',
    '2026-02-03T00:00',
  ])('refuses the malformed text %j', (value) => {
    expect(parseCalendarDate(value)).toBeNull();
  });

  it('refuses a year below 100, which Date.UTC would read as 19xx', () => {
    expect(isCalendarDate('0099-01-01')).toBe(false);
  });
});

describe('isWeekend', () => {
  it('is true on Saturday and Sunday', () => {
    expect(isWeekend('2026-11-21')).toBe(true); // Saturday
    expect(isWeekend('2026-11-22')).toBe(true); // Sunday
  });

  it('is false on the five other days', () => {
    for (const day of ['23', '24', '25', '26', '27']) {
      expect(isWeekend(`2026-11-${day}`)).toBe(false);
    }
  });

  it('refuses a date that is not a real calendar day', () => {
    expect(() => isWeekend('2026-02-30')).toThrow(RangeError);
  });
});

describe('isBusinessDay (BR-004-31)', () => {
  it('is true on a weekday that is no holiday', () => {
    expect(isBusinessDay('2026-11-23', NONE)).toBe(true);
  });

  it('is false on Saturday and Sunday', () => {
    expect(isBusinessDay('2026-11-21', NONE)).toBe(false);
    expect(isBusinessDay('2026-11-22', NONE)).toBe(false);
  });

  it('is false on a configured holiday that falls on a weekday', () => {
    expect(isBusinessDay('2026-12-25', new Set(['2026-12-25']))).toBe(false);
  });

  it('is true on a weekday that is not in the configured list', () => {
    expect(isBusinessDay('2026-12-24', new Set(['2026-12-25']))).toBe(true);
  });

  it('is false on a holiday that falls on a weekend, as without it', () => {
    expect(isBusinessDay('2026-11-21', new Set(['2026-11-21']))).toBe(false);
  });

  it('reads the year boundary: 31 December and 1 January are separate days', () => {
    const holidays = new Set(['2027-01-01']);
    expect(isBusinessDay('2026-12-31', holidays)).toBe(true); // Thursday
    expect(isBusinessDay('2027-01-01', holidays)).toBe(false); // Friday, Confraternização
    expect(isBusinessDay('2027-01-04', holidays)).toBe(true); // Monday
  });
});

describe('hasHolidaysInYear', () => {
  const holidays = new Set(['2026-12-25', '2027-01-01']);

  it('is true for a year with an entry', () => {
    expect(hasHolidaysInYear(2026, holidays)).toBe(true);
    expect(hasHolidaysInYear(2027, holidays)).toBe(true);
  });

  it('is false for a year with none, and for an empty calendar', () => {
    expect(hasHolidaysInYear(2028, holidays)).toBe(false);
    expect(hasHolidaysInYear(2026, NONE)).toBe(false);
  });
});

describe('yearOf', () => {
  it('is the year of the day', () => {
    expect(yearOf('2026-12-31')).toBe(2026);
  });

  it('refuses a date that is not a real calendar day', () => {
    expect(() => yearOf('nope')).toThrow(RangeError);
  });
});

describe('addCalendarDays', () => {
  it('moves by calendar days across month, year and leap-day ends', () => {
    expect(addCalendarDays('2025-11-10', 1)).toBe('2025-11-11');
    expect(addCalendarDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addCalendarDays('2026-01-01', 0)).toBe('2026-01-01');
  });

  it('refuses a day that does not exist', () => {
    expect(() => addCalendarDays('2026-02-30', 1)).toThrow(RangeError);
  });
});
