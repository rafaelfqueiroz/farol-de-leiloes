// TS-11 / AR-23: calendar logic on its boundaries — 23:59 and 00:00 in Brasília against UTC, month
// ends, 29 February — and a rule-based zone, not a fixed offset (SPEC-003 BR-003-28). Every
// expectation is a UTC instant worked out by hand, so the host's own zone plays no part.
import { describe, expect, it } from 'vitest';
import {
  BRASILIA_TIME_ZONE,
  brasiliaWallClockToInstant,
  endOfBrasiliaDay,
  isSameBrasiliaDay,
  startOfBrasiliaDay,
} from './brasilia-time.js';

const utc = (iso: string) => new Date(iso);

describe('BRASILIA_TIME_ZONE', () => {
  it('is the IANA zone, not an offset', () => {
    expect(BRASILIA_TIME_ZONE).toBe('America/Sao_Paulo');
  });
});

describe('brasiliaWallClockToInstant', () => {
  it('reads Caixa\'s "26/01/2026 - 10h00" as 13:00 UTC (Brasília is UTC-3)', () => {
    expect(
      brasiliaWallClockToInstant({ year: 2026, month: 1, day: 26, hours: 10, minutes: 0 }),
    ).toEqual(utc('2026-01-26T13:00:00.000Z'));
  });

  it('puts 23:59 of a Brasília day on the next UTC day', () => {
    // 31/01/2026 23:59 in Brasília = 01/02/2026 02:59 UTC.
    expect(
      brasiliaWallClockToInstant({ year: 2026, month: 1, day: 31, hours: 23, minutes: 59 }),
    ).toEqual(utc('2026-02-01T02:59:00.000Z'));
  });

  it('handles 29 February in a leap year', () => {
    // 29/02/2028 00:00 in Brasília = 29/02/2028 03:00 UTC.
    expect(brasiliaWallClockToInstant({ year: 2028, month: 2, day: 29 })).toEqual(
      utc('2028-02-29T03:00:00.000Z'),
    );
  });

  it('follows the zone rules: summer time made Brasília UTC-2 in December 2018', () => {
    // Brazil observed daylight saving until 2019: 01/12/2018 10:00 was UTC-2, so 12:00 UTC.
    // A fixed -03:00 offset would answer 13:00 UTC.
    expect(
      brasiliaWallClockToInstant({ year: 2018, month: 12, day: 1, hours: 10, minutes: 0 }),
    ).toEqual(utc('2018-12-01T12:00:00.000Z'));
  });

  it('defaults the time to midnight and keeps seconds', () => {
    expect(
      brasiliaWallClockToInstant({
        year: 2026,
        month: 1,
        day: 30,
        hours: 18,
        minutes: 0,
        seconds: 30,
      }),
    ).toEqual(utc('2026-01-30T21:00:30.000Z'));
  });
});

describe('startOfBrasiliaDay', () => {
  it('is 03:00 UTC of the same date for an instant after 03:00 UTC', () => {
    expect(startOfBrasiliaDay(utc('2026-01-15T12:00:00.000Z'))).toEqual(
      utc('2026-01-15T03:00:00.000Z'),
    );
  });

  it('is the previous date for an instant before 03:00 UTC (still yesterday in Brasília)', () => {
    // 01/02/2026 02:59 UTC is 31/01/2026 23:59 in Brasília: the month has not ended there yet.
    expect(startOfBrasiliaDay(utc('2026-02-01T02:59:59.999Z'))).toEqual(
      utc('2026-01-31T03:00:00.000Z'),
    );
    expect(startOfBrasiliaDay(utc('2026-02-01T03:00:00.000Z'))).toEqual(
      utc('2026-02-01T03:00:00.000Z'),
    );
  });

  it('lands on 29 February when 1 March has begun in UTC only', () => {
    // 01/03/2028 02:30 UTC = 29/02/2028 23:30 in Brasília.
    expect(startOfBrasiliaDay(utc('2028-03-01T02:30:00.000Z'))).toEqual(
      utc('2028-02-29T03:00:00.000Z'),
    );
  });
});

describe('endOfBrasiliaDay', () => {
  it('is 23:59:59.999 Brasília (02:59:59.999 UTC next day) for 23:59 and for 00:00 on the day', () => {
    // 15/01/2026 23:59 and 00:00 in Brasília.
    expect(endOfBrasiliaDay(utc('2026-01-16T02:59:00.000Z'))).toEqual(
      utc('2026-01-16T02:59:59.999Z'),
    );
    expect(endOfBrasiliaDay(utc('2026-01-15T03:00:00.000Z'))).toEqual(
      utc('2026-01-16T02:59:59.999Z'),
    );
  });

  it('ends the month on the last Brasília day', () => {
    expect(endOfBrasiliaDay(utc('2026-11-30T15:00:00.000Z'))).toEqual(
      utc('2026-12-01T02:59:59.999Z'),
    );
  });

  it('ends 29 February in a leap year', () => {
    expect(endOfBrasiliaDay(utc('2028-02-29T03:00:00.000Z'))).toEqual(
      utc('2028-03-01T02:59:59.999Z'),
    );
  });

  it('ends the year on 31 December', () => {
    expect(endOfBrasiliaDay(utc('2026-12-31T03:00:00.000Z'))).toEqual(
      utc('2027-01-01T02:59:59.999Z'),
    );
  });
});

describe('isSameBrasiliaDay', () => {
  it('compares Brasília calendar days, not UTC dates', () => {
    // 22:00 and 23:59 in Brasília on 15/01 fall on 16/01 in UTC; same Brasília day as 10:00.
    const morning = utc('2026-01-15T13:00:00.000Z');
    expect(isSameBrasiliaDay(utc('2026-01-16T01:00:00.000Z'), morning)).toBe(true);
    expect(isSameBrasiliaDay(utc('2026-01-16T02:59:00.000Z'), morning)).toBe(true);
    // 00:00 in Brasília on 16/01 is the next day.
    expect(isSameBrasiliaDay(utc('2026-01-16T03:00:00.000Z'), morning)).toBe(false);
  });

  it('crosses a month end and 29 February correctly', () => {
    expect(
      isSameBrasiliaDay(utc('2026-05-01T02:59:00.000Z'), utc('2026-04-30T12:00:00.000Z')),
    ).toBe(true);
    expect(
      isSameBrasiliaDay(utc('2028-03-01T02:59:00.000Z'), utc('2028-02-29T03:00:00.000Z')),
    ).toBe(true);
    expect(
      isSameBrasiliaDay(utc('2028-03-01T03:00:00.000Z'), utc('2028-02-29T03:00:00.000Z')),
    ).toBe(false);
  });
});
