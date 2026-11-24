import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemSleeper } from './sleeper.js';

describe('SystemSleeper', () => {
  afterEach(() => vi.useRealTimers());

  it('waits for the time asked and not less', async () => {
    vi.useFakeTimers();
    let woke = false;
    const sleeping = new SystemSleeper().sleep(5000).then(() => {
      woke = true;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(woke).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sleeping;
    expect(woke).toBe(true);
  });
});
