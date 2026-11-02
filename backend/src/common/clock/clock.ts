import { Injectable } from '@nestjs/common';

/**
 * AR-24: "now" is injected. Services ask a `Clock` for the current time instead of calling
 * `new Date()` or `Date.now()`, so deadlines, grace periods and retention are testable with a
 * fake clock (TS-06). `domain/` never sees a Clock: it receives the time as an argument (AR-05).
 *
 * An abstract class rather than an interface so it doubles as the Nest injection token.
 */
export abstract class Clock {
  abstract now(): Date;
}

/** The real clock, provided by CommonModule. Tests override it with `FakeClock`. */
@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
