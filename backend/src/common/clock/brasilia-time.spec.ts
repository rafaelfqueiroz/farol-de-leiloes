// TS-11 / AR-23: calendar logic on its boundaries — 23:59 and 00:00 in Brasília against UTC, month
// ends, 29 February — and a rule-based zone, not a fixed offset (SPEC-003 BR-003-28). Every
// expectation is a UTC instant worked out by hand, so the host's own zone plays no part.
import { describe, expect, it, inject } from 'vitest';
import {
  addYearsAnniversary,
  BRASILIA_TIME_MARKER,
  BRASILIA_TIME_ZONE,
  brasiliaCalendarDate,
  brasiliaMonthBounds,
  brasiliaToday,
  brasiliaWallClockToInstant,
  endOfBrasiliaDay,
  formatBrasiliaDateTime,
  formatBrasiliaDateTimeMarked,
  isSameBrasiliaDay,
  startOfBrasiliaDay,
} from './brasilia-time.js';

const utc = (iso: string) => new Date(iso);

declare module 'vitest' {
  export interface ProvidedContext {
    timeZone: string;
  }
}

describe('the host zone of this run', () => {
  it('is the one the tz-* project injected, so the matrix really varies the server zone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(inject('timeZone'));
  });
});

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

describe('addYearsAnniversary', () => {
  it('keeps the Brasília day and time: 15/01/2026 10:00 + 5 years = 15/01/2031 10:00', () => {
    expect(addYearsAnniversary(utc('2026-01-15T13:00:00.000Z'), 5)).toEqual(
      utc('2031-01-15T13:00:00.000Z'),
    );
  });

  it('moves 29 February to 1 March when the target year is not a leap year (BR-010-19)', () => {
    // 29/02/2028 10:00 in Brasília + 5 years = 01/03/2033 10:00 (2033 has no 29 February).
    expect(addYearsAnniversary(utc('2028-02-29T13:00:00.000Z'), 5)).toEqual(
      utc('2033-03-01T13:00:00.000Z'),
    );
  });

  it('keeps 29 February when the target year is a leap year', () => {
    expect(addYearsAnniversary(utc('2028-02-29T13:00:00.000Z'), 4)).toEqual(
      utc('2032-02-29T13:00:00.000Z'),
    );
  });

  it('treats a century year that is not a leap year as common (2100)', () => {
    expect(addYearsAnniversary(utc('2096-02-29T13:00:00.000Z'), 4)).toEqual(
      utc('2100-03-01T13:00:00.000Z'),
    );
  });

  it('reads the Brasília day, not the UTC date: 01/03 02:30 UTC is still 29/02 in Brasília', () => {
    // 29/02/2028 23:30 in Brasília = 01/03/2028 02:30 UTC; +1 year -> 01/03/2029 23:30 = 02:30 UTC on 02/03.
    expect(addYearsAnniversary(utc('2028-03-01T02:30:00.000Z'), 1)).toEqual(
      utc('2029-03-02T02:30:00.000Z'),
    );
  });

  it('does not touch a day that is 29 February in UTC only', () => {
    // 29/02/2028 02:30 UTC is 28/02/2028 23:30 in Brasília: an ordinary 28 February.
    expect(addYearsAnniversary(utc('2028-02-29T02:30:00.000Z'), 1)).toEqual(
      utc('2029-03-01T02:30:00.000Z'),
    );
  });

  it('follows the zone rules, not a fixed offset (BR-003-28)', () => {
    // 15/12/2018 12:00 was UTC-2 (summer time): 14:00 UTC. One year later, 15/12/2019, summer
    // time had been abolished: the same wall clock is 15:00 UTC.
    expect(addYearsAnniversary(utc('2018-12-15T14:00:00.000Z'), 1)).toEqual(
      utc('2019-12-15T15:00:00.000Z'),
    );
  });

  it('keeps seconds and milliseconds and accepts zero and negative years', () => {
    const base = utc('2026-06-10T12:34:56.789Z');
    expect(addYearsAnniversary(base, 0)).toEqual(base);
    expect(addYearsAnniversary(base, -1)).toEqual(utc('2025-06-10T12:34:56.789Z'));
  });
});

describe('brasiliaMonthBounds', () => {
  it('runs from midnight of the 1st to midnight of the next 1st in Brasília', () => {
    expect(brasiliaMonthBounds(utc('2026-01-15T12:00:00.000Z'))).toEqual({
      start: utc('2026-01-01T03:00:00.000Z'),
      end: utc('2026-02-01T03:00:00.000Z'),
    });
  });

  it('still reads January at 01/02 02:59 UTC, and February from 03:00 UTC (month edges)', () => {
    const january = {
      start: utc('2026-01-01T03:00:00.000Z'),
      end: utc('2026-02-01T03:00:00.000Z'),
    };
    expect(brasiliaMonthBounds(utc('2026-02-01T02:59:59.999Z'))).toEqual(january);
    expect(brasiliaMonthBounds(utc('2026-02-01T03:00:00.000Z'))).toEqual({
      start: utc('2026-02-01T03:00:00.000Z'),
      end: utc('2026-03-01T03:00:00.000Z'),
    });
  });

  it('starts a new month at 03:00 UTC on the 1st: 03:30Z is a new Brasília day', () => {
    // 01/03/2026 03:30 UTC = 01/03/2026 00:30 in Brasília: already March.
    expect(brasiliaMonthBounds(utc('2026-03-01T03:30:00.000Z')).start).toEqual(
      utc('2026-03-01T03:00:00.000Z'),
    );
    // 01/03/2026 02:30 UTC = 28/02/2026 23:30 in Brasília: still February.
    expect(brasiliaMonthBounds(utc('2026-03-01T02:30:00.000Z')).start).toEqual(
      utc('2026-02-01T03:00:00.000Z'),
    );
  });

  it('measures February by its Brasília length: 28 days, and 29 in a leap year', () => {
    const hours = (b: { start: Date; end: Date }) => (b.end.getTime() - b.start.getTime()) / 36e5;
    expect(hours(brasiliaMonthBounds(utc('2026-02-10T12:00:00.000Z')))).toBe(28 * 24);
    expect(hours(brasiliaMonthBounds(utc('2028-02-10T12:00:00.000Z')))).toBe(29 * 24);
  });

  it('rolls December into January of the next year', () => {
    expect(brasiliaMonthBounds(utc('2026-12-31T20:00:00.000Z'))).toEqual({
      start: utc('2026-12-01T03:00:00.000Z'),
      end: utc('2027-01-01T03:00:00.000Z'),
    });
  });

  it('follows the zone rules: November 2018 lost an hour to summer time (BR-003-28)', () => {
    // Summer time began on 04/11/2018, so 01/12/2018 00:00 was UTC-2 (02:00 UTC): the month is
    // 30 days minus an hour long. A fixed -03:00 offset would make it exactly 720 hours.
    const bounds = brasiliaMonthBounds(utc('2018-11-20T12:00:00.000Z'));
    expect(bounds).toEqual({
      start: utc('2018-11-01T03:00:00.000Z'),
      end: utc('2018-12-01T02:00:00.000Z'),
    });
    expect((bounds.end.getTime() - bounds.start.getTime()) / 36e5).toBe(30 * 24 - 1);
  });
});

describe('formatBrasiliaDateTime', () => {
  it('writes dd/mm/aaaa HH:mm in Brasília time', () => {
    expect(formatBrasiliaDateTime(utc('2026-01-26T13:00:00.000Z'))).toBe('26/01/2026 10:00');
  });

  it('shows a 02:30 UTC instant on the previous Brasília day', () => {
    expect(formatBrasiliaDateTime(utc('2026-02-01T02:30:00.000Z'))).toBe('31/01/2026 23:30');
  });

  it('marks the time as Brasília time', () => {
    expect(BRASILIA_TIME_MARKER).toBe('(horário de Brasília)');
    expect(formatBrasiliaDateTimeMarked(utc('2026-01-26T13:00:00.000Z'))).toBe(
      '26/01/2026 10:00 (horário de Brasília)',
    );
  });
});

describe('brasiliaCalendarDate and brasiliaToday (AR-22, SPEC-010 BR-010-19)', () => {
  it('is the Brasília day, so 23:59 in Brasília is still that day though UTC has moved on', () => {
    // 31/01/2026 23:59 Brasília = 01/02/2026 02:59 UTC; 00:00 on 01/02 Brasília = 03:00 UTC.
    expect(brasiliaCalendarDate(utc('2026-02-01T02:59:00.000Z'))).toBe('2026-01-31');
    expect(brasiliaCalendarDate(utc('2026-02-01T03:00:00.000Z'))).toBe('2026-02-01');
  });

  it('keeps an instant after 03:00 UTC on its own date', () => {
    expect(brasiliaCalendarDate(utc('2026-01-15T12:00:00.000Z'))).toBe('2026-01-15');
  });

  it('is 29 February while 1 March has begun in UTC only', () => {
    // 01/03/2028 02:30 UTC = 29/02/2028 23:30 Brasília.
    expect(brasiliaCalendarDate(utc('2028-03-01T02:30:00.000Z'))).toBe('2028-02-29');
  });

  it('ends the year on 31 December', () => {
    // 01/01/2027 02:59 UTC = 31/12/2026 23:59 Brasília.
    expect(brasiliaCalendarDate(utc('2027-01-01T02:59:00.000Z'))).toBe('2026-12-31');
    expect(brasiliaCalendarDate(utc('2027-01-01T03:00:00.000Z'))).toBe('2027-01-01');
  });

  it('follows the zone rules: in December 2018 (UTC-2) midnight in Brasília was 02:00 UTC', () => {
    // 30/11/2018 23:59 Brasília (UTC-2) = 01/12/2018 01:59 UTC.
    expect(brasiliaCalendarDate(utc('2018-12-01T01:59:00.000Z'))).toBe('2018-11-30');
    expect(brasiliaCalendarDate(utc('2018-12-01T02:00:00.000Z'))).toBe('2018-12-01');
  });

  it('brasiliaToday reads the injected clock', () => {
    const at = (iso: string) => ({ now: () => utc(iso) });
    expect(brasiliaToday(at('2026-02-01T02:59:00.000Z'))).toBe('2026-01-31');
    expect(brasiliaToday(at('2026-02-01T03:00:00.000Z'))).toBe('2026-02-01');
  });
});
