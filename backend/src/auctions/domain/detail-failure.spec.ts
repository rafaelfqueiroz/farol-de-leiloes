import { describe, expect, it } from 'vitest';
import { backoffDays, MAX_BACKOFF_DAYS, retryAfter, stopsThePass } from './detail-failure.js';
import { brasiliaInstant } from './import-schedule.js';

describe('backoffDays (BR-004-21)', () => {
  it('starts at the base and doubles with each failure in a row', () => {
    expect([1, 2, 3, 4, 5].map((failures) => backoffDays(1, failures))).toEqual([1, 2, 4, 8, 16]);
    expect([1, 2, 3].map((failures) => backoffDays(3, failures))).toEqual([3, 6, 12]);
  });

  it('stops growing at the bound', () => {
    expect(MAX_BACKOFF_DAYS).toBe(16);
    expect(backoffDays(1, 6)).toBe(16);
    expect(backoffDays(1, 9)).toBe(16);
    expect(backoffDays(1, 1000)).toBe(16);
    expect(backoffDays(5, 3)).toBe(16); // 20 would pass the bound
  });

  it('never goes below the configured base, even above the bound', () => {
    expect(backoffDays(20, 1)).toBe(20);
    expect(backoffDays(20, 2)).toBe(20);
  });

  it('treats a count below one as the first failure', () => {
    expect(backoffDays(2, 0)).toBe(2);
    expect(backoffDays(2, -4)).toBe(2);
  });
});

describe('retryAfter', () => {
  it('is midnight in Brasília that many days on, whatever the time of the failure', () => {
    const lateEvening = brasiliaInstant('2026-11-24', 23 * 60 + 50);
    expect(retryAfter(lateEvening, 1, 1)).toEqual(brasiliaInstant('2026-11-25', 0));
    expect(retryAfter(lateEvening, 1, 3)).toEqual(brasiliaInstant('2026-11-28', 0));
  });

  it('reads the day in Brasília, not in UTC', () => {
    // 2026-11-25T01:00Z is still the 24th in Brasília.
    expect(retryAfter(new Date('2026-11-25T01:00:00Z'), 1, 1)).toEqual(
      new Date('2026-11-25T03:00:00.000Z'),
    );
  });
});

describe('stopsThePass', () => {
  it('stops at the limit and not before', () => {
    expect(stopsThePass(4, 5)).toBe(false);
    expect(stopsThePass(5, 5)).toBe(true);
    expect(stopsThePass(6, 5)).toBe(true);
  });
});
