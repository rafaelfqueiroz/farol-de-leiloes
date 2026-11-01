import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, parseDate, relativeParts, toDateTimeAttribute } from './dates';

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
