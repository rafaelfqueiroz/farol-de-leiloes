import { describe, expect, it } from 'vitest';
import { SystemClock } from './clock';

describe('SystemClock (AR-24)', () => {
  it('returns the current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('returns a new Date on each call, so callers cannot mutate a shared instance', () => {
    const clock = new SystemClock();

    expect(clock.now()).not.toBe(clock.now());
  });
});
