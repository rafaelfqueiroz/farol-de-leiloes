// SPEC-004 BR-004-31: the calendar service over the configured holidays, with the injected clock
// (AR-24) and a spy on the log (the warning is once per process per year).
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusinessCalendar } from './business-calendar.service.js';
import { FakeClock } from '../../../test/fakes/fake-clock.js';
import { testBusinessConfig } from '../../../test/support/test-env.js';

function build(holidays: string, now = '2026-11-23T15:00:00.000Z') {
  const clock = new FakeClock(new Date(now));
  const calendar = new BusinessCalendar(testBusinessConfig({ NATIONAL_HOLIDAYS: holidays }), clock);
  return { calendar, clock };
}

describe('BusinessCalendar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts a weekday as a business day and a weekend day as none', () => {
    const { calendar } = build('2026-12-25');
    expect(calendar.isBusinessDay('2026-11-23')).toBe(true); // Monday
    expect(calendar.isBusinessDay('2026-11-21')).toBe(false); // Saturday
    expect(calendar.isBusinessDay('2026-11-22')).toBe(false); // Sunday
  });

  it('counts a configured holiday as no business day, and the day before it as one', () => {
    const { calendar } = build('2026-12-25');
    expect(calendar.isBusinessDay('2026-12-25')).toBe(false);
    expect(calendar.isBusinessDay('2026-12-24')).toBe(true);
  });

  it('reads today in Brasília: 23:30 on Friday is still Friday, 00:30 UTC on Saturday', () => {
    const { calendar, clock } = build('', '2026-11-28T02:30:00.000Z'); // Fri 27/11 23:30 Brasília
    expect(calendar.isBusinessDayToday()).toBe(true);
    clock.set(new Date('2026-11-28T03:00:00.000Z')); // Sat 28/11 00:00 Brasília
    expect(calendar.isBusinessDayToday()).toBe(false);
  });

  describe('a year with no entries (BR-004-31)', () => {
    it('warns once per process per year and treats only weekends as non-business days', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { calendar } = build('2027-01-01');

      expect(calendar.isBusinessDay('2026-12-25')).toBe(true); // no 2026 entry: a plain Friday
      expect(calendar.isBusinessDay('2026-12-24')).toBe(true);
      expect(calendar.isBusinessDay('2026-11-22')).toBe(false); // Sunday
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('2026');

      expect(calendar.isBusinessDay('2027-01-01')).toBe(false); // configured: no warning
      expect(warn).toHaveBeenCalledTimes(1);

      expect(calendar.isBusinessDay('2028-03-01')).toBe(true); // another year: warns again
      expect(calendar.isBusinessDay('2028-03-02')).toBe(true);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('does not warn for a year that has an entry', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      build('2026-12-25').calendar.isBusinessDay('2026-11-23');
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
