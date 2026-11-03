import { describe, expect, it } from 'vitest';
import {
  calendarToWallClock,
  formatDate,
  formatDateTime,
  instantToWallClock,
  parseDate,
  relativeParts,
  toDateTimeAttribute,
  wallClockToCalendar,
  wallClockToInstant,
} from './dates';

// America/Sao_Paulo is UTC-3 all year (no DST since 2019), so the expectations are fixed.

describe('formatDate', () => {
  it('formats an instant in Brasília time', () => {
    expect(formatDate('2026-03-10T15:30:00Z')).toBe('10/03/2026');
  });

  it('converts across midnight: 02:00 UTC is still the previous day in Brasília', () => {
    expect(formatDate('2026-03-10T02:00:00Z')).toBe('09/03/2026');
    expect(formatDate('2026-03-10T03:00:00Z')).toBe('10/03/2026');
    expect(formatDate('2026-03-10T02:59:59Z')).toBe('09/03/2026');
  });

  it('crosses a year boundary', () => {
    expect(formatDate('2026-01-01T01:00:00Z')).toBe('31/12/2025');
  });

  it('honours an explicit offset', () => {
    expect(formatDate('2026-03-10T23:30:00-03:00')).toBe('10/03/2026');
    expect(formatDate('2026-03-10T23:30:00+00:00')).toBe('10/03/2026');
    expect(formatDate('2026-03-10T00:30:00+05:00')).toBe('09/03/2026');
  });

  it('never shifts a calendar date', () => {
    expect(formatDate('2026-03-10')).toBe('10/03/2026');
    expect(formatDate('2026-01-01')).toBe('01/01/2026');
    expect(formatDate('2028-02-29')).toBe('29/02/2028');
  });
});

describe('formatDateTime', () => {
  it('formats date and time in Brasília', () => {
    expect(formatDateTime('2026-03-10T15:30:00Z')).toBe('10/03/2026 12:30');
  });

  it('shows midnight as 00:00, not 24:00', () => {
    expect(formatDateTime('2026-03-10T03:00:00Z')).toBe('10/03/2026 00:00');
    expect(formatDateTime('2026-03-11T02:59:00Z')).toBe('10/03/2026 23:59');
  });

  it('keeps a calendar date date-only', () => {
    expect(formatDateTime('2026-03-10')).toBe('10/03/2026');
  });

  it('accepts fractional seconds', () => {
    expect(formatDateTime('2026-03-10T15:30:00.123Z')).toBe('10/03/2026 12:30');
  });
});

describe('parseDate', () => {
  it('rejects impossible calendar dates', () => {
    expect(() => parseDate('2026-02-31')).toThrow(RangeError);
    expect(() => parseDate('2026-13-01')).toThrow(RangeError);
    expect(() => parseDate('2027-02-29')).toThrow(RangeError);
  });

  it('rejects an instant without a zone (ambiguous) and free text', () => {
    expect(() => parseDate('2026-03-10T15:30:00')).toThrow(RangeError);
    expect(() => parseDate('10/03/2026')).toThrow(RangeError);
    expect(() => parseDate('')).toThrow(RangeError);
  });
});

describe('toDateTimeAttribute', () => {
  it('keeps a calendar date and normalises an instant to UTC', () => {
    expect(toDateTimeAttribute('2026-03-10')).toBe('2026-03-10');
    expect(toDateTimeAttribute('2026-03-10T12:30:00-03:00')).toBe('2026-03-10T15:30:00.000Z');
  });
});

describe('relativeParts', () => {
  const now = new Date('2026-03-10T15:00:00Z'); // 12:00 in Brasília

  it('says "now" within a minute', () => {
    expect(relativeParts('2026-03-10T15:00:30Z', now)).toEqual({
      unit: 'now',
      count: 0,
      direction: 'future',
    });
    expect(relativeParts('2026-03-10T14:59:30Z', now).direction).toBe('past');
  });

  it('counts minutes under an hour, rounding down', () => {
    expect(relativeParts('2026-03-10T15:45:59Z', now)).toEqual({
      unit: 'minutes',
      count: 45,
      direction: 'future',
    });
  });

  it('counts hours under a day', () => {
    expect(relativeParts('2026-03-10T13:00:00Z', now)).toEqual({
      unit: 'hours',
      count: 2,
      direction: 'past',
    });
    expect(relativeParts('2026-03-11T14:59:00Z', now)).toMatchObject({ unit: 'hours', count: 23 });
  });

  it('counts calendar days in Brasília from a day on', () => {
    expect(relativeParts('2026-03-24T15:00:00Z', now)).toEqual({
      unit: 'days',
      count: 14,
      direction: 'future',
    });
    expect(relativeParts('2026-03-08T15:00:00Z', now)).toMatchObject({
      unit: 'days',
      count: 2,
      direction: 'past',
    });
  });

  it('uses the Brasília day, not the UTC day, at the boundary', () => {
    // 01:00 UTC on the 12th is 22:00 on the 11th in Brasília: one calendar day ahead of "now"
    expect(relativeParts('2026-03-12T01:00:00Z', now)).toMatchObject({ unit: 'days', count: 1 });
  });

  it('compares a calendar date in whole days', () => {
    expect(relativeParts('2026-03-10', now)).toEqual({
      unit: 'today',
      count: 0,
      direction: 'future',
    });
    expect(relativeParts('2026-03-24', now)).toEqual({
      unit: 'days',
      count: 14,
      direction: 'future',
    });
    expect(relativeParts('2026-03-09', now)).toEqual({
      unit: 'days',
      count: 1,
      direction: 'past',
    });
  });

  it('treats "today" by the Brasília clock when UTC has already rolled over', () => {
    const lateEvening = new Date('2026-03-11T01:30:00Z'); // 22:30 on the 10th in Brasília
    expect(relativeParts('2026-03-10', lateEvening).unit).toBe('today');
    expect(relativeParts('2026-03-11', lateEvening)).toMatchObject({ unit: 'days', count: 1 });
  });
});

// TS-11: the picker helpers hold Brasília wall-clock fields in a plain Date. The assertions read
// those fields (getHours...), not the instant, so they hold whatever zone the machine runs in.
const fields = (d: Date) => [
  d.getFullYear(),
  d.getMonth() + 1,
  d.getDate(),
  d.getHours(),
  d.getMinutes(),
];

describe('instantToWallClock', () => {
  it('shows 23:59 in Brasília for 02:59 UTC the next day', () => {
    expect(fields(instantToWallClock('2026-03-11T02:59:00Z'))).toEqual([2026, 3, 10, 23, 59]);
  });

  it('shows 00:00 in Brasília for 03:00 UTC', () => {
    expect(fields(instantToWallClock('2026-03-10T03:00:00Z'))).toEqual([2026, 3, 10, 0, 0]);
  });

  it('crosses a month end and a year end', () => {
    expect(fields(instantToWallClock('2026-02-01T02:59:00Z'))).toEqual([2026, 1, 31, 23, 59]);
    expect(fields(instantToWallClock('2026-01-01T02:00:00Z'))).toEqual([2025, 12, 31, 23, 0]);
  });

  it('keeps 29 February', () => {
    expect(fields(instantToWallClock('2028-02-29T03:00:00Z'))).toEqual([2028, 2, 29, 0, 0]);
    expect(fields(instantToWallClock('2028-03-01T02:59:00Z'))).toEqual([2028, 2, 29, 23, 59]);
  });

  it('uses the zone rules of the date: Brasília was UTC-2 in the 2018 summer time', () => {
    expect(fields(instantToWallClock('2018-11-10T14:00:00Z'))).toEqual([2018, 11, 10, 12, 0]);
    expect(fields(instantToWallClock('2019-11-10T14:00:00Z'))).toEqual([2019, 11, 10, 11, 0]);
  });

  it('honours an explicit offset', () => {
    expect(fields(instantToWallClock('2026-03-10T23:59:00-03:00'))).toEqual([2026, 3, 10, 23, 59]);
  });

  it('rejects a calendar date, which has no instant', () => {
    expect(() => instantToWallClock('2026-03-10')).toThrow(RangeError);
  });
});

describe('wallClockToInstant', () => {
  it('turns 23:59 Brasília into the next UTC day', () => {
    expect(wallClockToInstant(new Date(2026, 2, 10, 23, 59))).toBe('2026-03-11T02:59:00.000Z');
  });

  it('turns 00:00 Brasília into 03:00 UTC the same day', () => {
    expect(wallClockToInstant(new Date(2026, 2, 10, 0, 0))).toBe('2026-03-10T03:00:00.000Z');
  });

  it('crosses a month end', () => {
    expect(wallClockToInstant(new Date(2026, 0, 31, 23, 59))).toBe('2026-02-01T02:59:00.000Z');
  });

  it('keeps 29 February', () => {
    expect(wallClockToInstant(new Date(2028, 1, 29, 0, 0))).toBe('2028-02-29T03:00:00.000Z');
    expect(wallClockToInstant(new Date(2028, 1, 29, 23, 59))).toBe('2028-03-01T02:59:00.000Z');
  });

  it('uses the zone rules of the date, not a fixed offset', () => {
    expect(wallClockToInstant(new Date(2018, 10, 10, 12, 0))).toBe('2018-11-10T14:00:00.000Z');
    expect(wallClockToInstant(new Date(2019, 10, 10, 12, 0))).toBe('2019-11-10T15:00:00.000Z');
  });

  it('round-trips with instantToWallClock', () => {
    for (const instant of [
      '2026-03-11T02:59:00.000Z',
      '2026-03-10T03:00:00.000Z',
      '2028-02-29T03:00:00.000Z',
    ]) {
      expect(wallClockToInstant(instantToWallClock(instant))).toBe(instant);
    }
  });
});

describe('calendar dates in a picker', () => {
  it('never shifts a calendar date', () => {
    expect(fields(calendarToWallClock('2026-03-10')).slice(0, 3)).toEqual([2026, 3, 10]);
    expect(wallClockToCalendar(calendarToWallClock('2028-02-29'))).toBe('2028-02-29');
    expect(wallClockToCalendar(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('rejects an instant and an impossible date', () => {
    expect(() => calendarToWallClock('2026-03-10T03:00:00Z')).toThrow(RangeError);
    expect(() => calendarToWallClock('2026-02-30')).toThrow(RangeError);
  });
});
