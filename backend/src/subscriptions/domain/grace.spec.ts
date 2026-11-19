// SPEC-012 BR-012-21, BR-012-28 (D-47): the 10-day grace period after a lapse, on hand-computed
// instants. The period is the half-open interval [lapsedAt, lapsedAt + 10 days).
import { describe, expect, it } from 'vitest';
import { formatBrasiliaDateTime } from '../../common/clock/brasilia-time.js';
import { isReadOnly, readOnlyAtOf } from './grace.js';

const LAPSED_AT = new Date('2026-03-01T12:00:00.000Z');

describe('readOnlyAtOf', () => {
  it('BR-012-28: is the lapse plus the grace days (10 days: 2026-03-01T12:00Z → 2026-03-11T12:00Z)', () => {
    expect(readOnlyAtOf(LAPSED_AT, 10)).toEqual(new Date('2026-03-11T12:00:00.000Z'));
  });

  it('follows the setting (AR-43): 3 days → 2026-03-04T12:00Z', () => {
    expect(readOnlyAtOf(LAPSED_AT, 3)).toEqual(new Date('2026-03-04T12:00:00.000Z'));
  });

  it('adds whole 24-hour days across a month end (2026-02-25T10:00Z + 10 d = 2026-03-07T10:00Z)', () => {
    // 2026 is not a leap year: February has 28 days. 25 Feb + 10 days → 7 Mar.
    expect(readOnlyAtOf(new Date('2026-02-25T10:00:00.000Z'), 10)).toEqual(
      new Date('2026-03-07T10:00:00.000Z'),
    );
  });

  it('BR-012-15: a lapse at 00:30 UTC is read-only at 00:30 UTC ten days later, which Brasília shows on the previous day', () => {
    const lapsedAt = new Date('2026-03-01T00:30:00.000Z');
    const readOnlyAt = readOnlyAtOf(lapsedAt, 10);

    expect(readOnlyAt).toEqual(new Date('2026-03-11T00:30:00.000Z'));
    // 00:30 UTC is 21:30 of the day before in Brasília (UTC-3): 28/02 and 10/03.
    expect(formatBrasiliaDateTime(lapsedAt)).toContain('28/02/2026');
    expect(formatBrasiliaDateTime(readOnlyAt)).toContain('10/03/2026');
  });
});

describe('isReadOnly', () => {
  it('BR-012-21: just after the lapse everything still works', () => {
    expect(isReadOnly(LAPSED_AT, LAPSED_AT, 10)).toBe(false);
  });

  it('BR-012-28: a write on day 9 is allowed (2026-03-10T12:00Z)', () => {
    expect(isReadOnly(LAPSED_AT, new Date('2026-03-10T12:00:00.000Z'), 10)).toBe(false);
  });

  it('BR-012-28: one millisecond before the boundary is still writable', () => {
    expect(isReadOnly(LAPSED_AT, new Date('2026-03-11T11:59:59.999Z'), 10)).toBe(false);
  });

  it('BR-012-28: exactly at lapse + 10 days the office is read-only', () => {
    expect(isReadOnly(LAPSED_AT, new Date('2026-03-11T12:00:00.000Z'), 10)).toBe(true);
  });

  it('BR-012-28: a write on day 11 is refused (2026-03-12T12:00Z)', () => {
    expect(isReadOnly(LAPSED_AT, new Date('2026-03-12T12:00:00.000Z'), 10)).toBe(true);
  });
});
