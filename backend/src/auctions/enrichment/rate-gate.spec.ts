// SPEC-004 BR-004-18, SC-24: the gate's two promises, in fake time (TS-06): at most `concurrency`
// requests in flight, and request starts at least `minPauseMs` apart, fixed, never random.
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../test/fakes/fake-clock.js';
import { FakeSleeper } from '../../../test/fakes/fake-sleeper.js';
import { RateGate } from './rate-gate.js';

const START = new Date('2026-11-24T12:00:00.000Z');

function setup(concurrency: number, minPauseMs: number) {
  const clock = new FakeClock(START);
  const sleeper = new FakeSleeper(clock);
  const gate = new RateGate(clock, sleeper, { concurrency, minPauseMs });
  return { clock, sleeper, gate };
}

/** A request that takes `durationMs` of fake time, recording when it started and ended. */
function request(
  env: ReturnType<typeof setup>,
  log: { start: number; end: number }[],
  durationMs: number,
) {
  return env.gate.run(async ({ startedAt }) => {
    const start = startedAt.getTime() - START.getTime();
    await env.sleeper.sleep(durationMs);
    log.push({ start, end: env.clock.now().getTime() - START.getTime() });
  });
}

describe('RateGate', () => {
  it('lets the first request start at once and holds the second back for the pause', async () => {
    const env = setup(1, 5000);
    const log: { start: number; end: number }[] = [];

    await env.sleeper.drive(Promise.all([request(env, log, 100), request(env, log, 100)]));

    expect(log).toEqual([
      { start: 0, end: 100 },
      { start: 5000, end: 5100 },
    ]);
  });

  it('keeps every start exactly the pause apart when requests are shorter than the pause', async () => {
    const env = setup(1, 2000);
    const log: { start: number; end: number }[] = [];

    await env.sleeper.drive(Promise.all(Array.from({ length: 6 }, () => request(env, log, 300))));

    expect(log.map((entry) => entry.start)).toEqual([0, 2000, 4000, 6000, 8000, 10_000]);
  });

  it('waits for a request longer than the pause, then starts the next one at once', async () => {
    const env = setup(1, 1000);
    const log: { start: number; end: number }[] = [];

    await env.sleeper.drive(Promise.all([request(env, log, 3000), request(env, log, 10)]));

    // One in flight at a time: the second starts when the first ends, which is past the pause.
    expect(log).toEqual([
      { start: 0, end: 3000 },
      { start: 3000, end: 3010 },
    ]);
  });

  it.each([1, 2, 3, 4])(
    'never has more than %s requests in flight, and starts at least the pause apart',
    async (concurrency) => {
      const env = setup(concurrency, 1000);
      const log: { start: number; end: number }[] = [];

      await env.sleeper.drive(
        Promise.all(Array.from({ length: 12 }, () => request(env, log, 5500))),
      );

      expect(log).toHaveLength(12);
      const starts = log.map((entry) => entry.start).sort((a, b) => a - b);
      const gaps = starts.slice(1).map((start, i) => start - (starts[i] ?? 0));
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000);
      // The most requests running at one instant: sampled at every start.
      const peak = Math.max(
        ...log.map(
          ({ start }) => log.filter((other) => other.start <= start && other.end > start).length,
        ),
      );
      expect(peak).toBeLessThanOrEqual(concurrency);
      // ... and the gate really uses what it is allowed: 5.5 s requests, 1 s apart.
      expect(peak).toBe(concurrency);
    },
  );

  it('uses the same fixed pause every time: no jitter', async () => {
    const env = setup(1, 1500);
    const log: { start: number; end: number }[] = [];

    await env.sleeper.drive(Promise.all(Array.from({ length: 5 }, () => request(env, log, 1))));

    const gaps = log.slice(1).map((entry, i) => entry.start - (log[i]?.start ?? 0));
    expect(new Set(gaps)).toEqual(new Set([1500]));
  });

  it('frees the slot when a request fails, so the next one is not stuck', async () => {
    const env = setup(1, 1000);
    const failed = env.gate.run(() => Promise.reject(new Error('boom')));
    const log: { start: number; end: number }[] = [];

    const outcome = await env.sleeper.drive(Promise.allSettled([failed, request(env, log, 10)]));

    expect(outcome[0].status).toBe('rejected');
    expect(outcome[1].status).toBe('fulfilled');
    expect(log).toEqual([{ start: 1000, end: 1010 }]);
  });

  it('returns what the request returns', async () => {
    const env = setup(1, 1000);

    await expect(env.gate.run(() => Promise.resolve(42))).resolves.toBe(42);
  });

  it('waits again when a sleep returns early (a timer that fires before the pause is over)', async () => {
    const env = setup(1, 1000);
    // A sleeper that wakes up 400 ms early the first time.
    let early = true;
    const impatient = {
      sleep: async (ms: number) => {
        env.clock.advance(early ? ms - 400 : ms);
        early = false;
      },
    };
    const gate = new RateGate(env.clock, impatient, { concurrency: 1, minPauseMs: 1000 });
    const starts: number[] = [];

    for (let i = 0; i < 2; i++) {
      await gate.run(({ startedAt }) => {
        starts.push(startedAt.getTime() - START.getTime());
        return Promise.resolve();
      });
    }

    expect(starts).toEqual([0, 1000]);
  });
});
