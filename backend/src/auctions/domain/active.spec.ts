import { describe, expect, it } from 'vitest';
import { isActive } from './active.js';

const NOW = new Date('2026-03-10T13:00:00.000Z'); // 10h00 in Brasília
const at = (iso: string) => new Date(iso);

describe('isActive (BR-004-16)', () => {
  it('is false for a property the last list did not mark available, whatever its dates', () => {
    expect(isActive({ available: false, rounds: [{ date: null }] }, NOW)).toBe(false);
    expect(isActive({ available: false, rounds: [] }, NOW)).toBe(false);
  });

  it('keeps a property whose rounds were not collected yet active (unknown, BR-004-15)', () => {
    expect(isActive({ available: true, rounds: [] }, NOW)).toBe(true);
  });

  it('is active while a round date is still ahead', () => {
    const rounds = [{ date: at('2026-03-10T12:59:59.999Z') }, { date: at('2026-03-16T13:00:00Z') }];
    expect(isActive({ available: true, rounds }, NOW)).toBe(true);
  });

  it('is active with an open-ended round, however old the other dates', () => {
    const rounds = [{ date: at('2020-01-01T00:00:00Z') }, { date: null }];
    expect(isActive({ available: true, rounds }, NOW)).toBe(true);
  });

  it('is inactive once every date has passed, a date equal to now having passed', () => {
    expect(isActive({ available: true, rounds: [{ date: NOW }] }, NOW)).toBe(false);
    expect(isActive({ available: true, rounds: [{ date: at('2026-03-09T13:00:00Z') }] }, NOW)).toBe(
      false,
    );
  });
});
