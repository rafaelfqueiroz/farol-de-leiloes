import { Injectable } from '@nestjs/common';

/**
 * AR-24 (the twin of `Clock` for waiting): code that must pause between two requests asks a
 * `Sleeper` instead of calling `setTimeout`, so a spec runs the pause in fake time (TS-06) and
 * never really waits. An abstract class so it doubles as the Nest injection token.
 */
export abstract class Sleeper {
  abstract sleep(milliseconds: number): Promise<void>;
}

/** The real one, provided by AuctionsModule for the detail collection (SC-24: the pause is real). */
@Injectable()
export class SystemSleeper extends Sleeper {
  sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
