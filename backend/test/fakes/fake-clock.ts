import { Clock } from '../../src/common/clock/clock.js';

/** 2026-01-15T12:00:00Z — an arbitrary fixed instant, so no test depends on the day it runs. */
export const DEFAULT_FAKE_NOW = new Date('2026-01-15T12:00:00.000Z');

/**
 * TS-06: a hand-written fake of the `Clock` port (TS-03). Time stands still until a test moves
 * it with `set` or `advance`; nothing sleeps.
 *
 *   const clock = new FakeClock(new Date('2026-03-01T00:00:00Z'));
 *   clock.advance(2 * HOUR);
 */
export class FakeClock extends Clock {
  private current: Date;

  constructor(now: Date = DEFAULT_FAKE_NOW) {
    super();
    this.current = new Date(now.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(now: Date): void {
    this.current = new Date(now.getTime());
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
