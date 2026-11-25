import { Sleeper } from '../../src/common/clock/sleeper.js';
import type { FakeClock } from './fake-clock.js';

/**
 * TS-06: the fake of the `Sleeper` port. Nothing really waits: a `sleep` registers a timer on the
 * FakeClock's timeline, and `drive(work)` moves fake time to each pending timer in turn (earliest
 * first) until `work` settles. Between two steps it gives real I/O (a database round trip) a
 * moment to finish, so the specs that run the collection against MongoDB use it too.
 */
/**
 * Real milliseconds of quiet before fake time moves on: a database round trip in flight (a few ms
 * on a local container) finishes first, so a request that is still being recorded is not overtaken
 * by the pause timer of the next one.
 */
const QUIET_MS = 30;

export class FakeSleeper extends Sleeper {
  /** Every pause that was asked for, in order. */
  readonly sleeps: number[] = [];
  private timers: { at: number; resolve: () => void }[] = [];

  constructor(private readonly clock: FakeClock) {
    super();
  }

  sleep(milliseconds: number): Promise<void> {
    this.sleeps.push(milliseconds);
    return new Promise((resolve) => {
      this.timers.push({ at: this.clock.now().getTime() + milliseconds, resolve });
    });
  }

  /** Fake time to the next timer, as the sleeper of a spec that needs no I/O would. */
  private fireNext(): boolean {
    this.timers.sort((a, b) => a.at - b.at);
    const next = this.timers.shift();
    if (next === undefined) return false;
    if (next.at > this.clock.now().getTime()) this.clock.set(new Date(next.at));
    next.resolve();
    return true;
  }

  /**
   * Runs fake time until `work` settles (`quietMs`: 1 for a spec with no database, where nothing
   * is in flight between two timers).
   * (it fails after `realTimeoutMs` of real time: a deadlock). */
  async drive<T>(work: Promise<T>, realTimeoutMs = 20_000, quietMs = QUIET_MS): Promise<T> {
    let settled = false;
    const watched = work.finally(() => {
      settled = true;
    });
    watched.catch(() => undefined);
    const deadline = Date.now() + realTimeoutMs;
    while (!settled) {
      await new Promise((resolve) => setTimeout(resolve, quietMs)); // I/O and microtasks get their turn
      if (settled) break;
      this.fireNext();
      if (Date.now() > deadline) throw new Error('FakeSleeper.drive: the work never settled');
    }
    return watched;
  }
}
