// SPEC-004 BR-004-18, SC-24: the one gate every request of the detail collection passes. It makes
// two promises, whichever worker asks and whatever the request is (a page, a photo, a document):
//
//   - at most `concurrency` requests are in flight at once;
//   - two request STARTS are at least `minPauseMs` apart: a fixed interval, never randomised, so an
//     operator can verify the rate from the log (docs/runbooks/caixa-import.md).
//
// Starts are admitted one at a time in the order they asked (a chain), so two workers can never
// both read the same "last start" and start together. Time comes from the injected Clock and the
// waiting from the injected Sleeper (AR-24), so a spec drives it in fake time.
import { Clock } from '../../common/clock/clock.js';
import { Sleeper } from '../../common/clock/sleeper.js';

export interface RateGateLimits {
  concurrency: number;
  minPauseMs: number;
}

/** What a request learns when it is admitted. */
export interface GateSlot {
  /** The instant the request was allowed to start. */
  startedAt: Date;
}

export class RateGate {
  private inFlight = 0;
  private lastStartMs: number | null = null;
  private readonly released: (() => void)[] = [];
  /** The admission of the previous request: the next one is decided only after it. */
  private admissions: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly clock: Clock,
    private readonly sleeper: Sleeper,
    private readonly limits: RateGateLimits,
  ) {}

  /** Runs `task` once the gate lets it start; the slot is freed when it settles, however it ends. */
  async run<T>(task: (slot: GateSlot) => Promise<T>): Promise<T> {
    const admission = this.admissions.then(() => this.admit());
    // A failed admission (it cannot be, bar a sleeper that throws) must not wedge the queue.
    this.admissions = admission.catch(() => undefined);
    const slot = await admission;
    try {
      return await task(slot);
    } finally {
      this.release();
    }
  }

  private async admit(): Promise<GateSlot> {
    // Admissions are serial, so in-flight only goes DOWN while this one waits: the check holds.
    while (this.inFlight >= this.limits.concurrency) {
      await new Promise<void>((resolve) => this.released.push(resolve));
    }
    for (;;) {
      const wait =
        this.lastStartMs === null
          ? 0
          : this.lastStartMs + this.limits.minPauseMs - this.clock.now().getTime();
      if (wait <= 0) break;
      await this.sleeper.sleep(wait);
    }
    const startedAt = this.clock.now();
    this.lastStartMs = startedAt.getTime();
    this.inFlight++;
    return { startedAt };
  }

  private release(): void {
    this.inFlight--;
    this.released.shift()?.();
  }
}
