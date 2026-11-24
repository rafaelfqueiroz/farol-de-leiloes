import { Injectable, Logger } from '@nestjs/common';
import { jobErrorCode } from '../../common/services/job-error-code.js';

/**
 * SPEC-004 BR-004-23: the daily update is complete (the day's list is applied and the collection
 * pass ended). Ids and a day only (SC-15).
 */
export interface DailyUpdateCompleted {
  /** The Import Run (hex ObjectId): `importruns._id`. */
  importRunId: string;
  /** The run's Brasília calendar day, `YYYY-MM-DD` (AR-22). */
  brasiliaDate: string;
}

export type DailyUpdateHandler = (event: DailyUpdateCompleted) => void | Promise<void>;

/**
 * The in-process "daily update complete" signal (BR-004-23): no new dependency. The Radar
 * (SPEC-013) and the digest (SPEC-008, BR-008-22) subscribe, or read `updateCompletedAt` of the
 * Import Run (`ImportRunService.lastUpdateAt`, the poll alternative; it is what survives a restart).
 *
 * `ImportOrchestrator` emits it once per day, right after the `updateCompletedAt` null -> now
 * update succeeded for it: never twice for one run, never for a run that did not end SUCCESS, never
 * for NO_UPDATE. A handler that throws or rejects is logged by its code and affects nothing else:
 * not the run, not the other handlers. Handlers must be quick (queue the work): a handler that
 * never settles delays only its own settle, never the tick.
 */
@Injectable()
export class DailyUpdateBus {
  private readonly logger = new Logger(DailyUpdateBus.name);
  private readonly handlers = new Set<DailyUpdateHandler>();

  /** Registers a handler; the returned function removes it. */
  subscribe(handler: DailyUpdateHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Hands the event to every handler, each on its own: a synchronous throw or a rejection of one
   * is logged and the others still run. Never rejects; resolves when every handler settled.
   */
  async emit(event: DailyUpdateCompleted): Promise<void> {
    await Promise.all(
      [...this.handlers].map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          // SC-15: the code, never the message.
          this.logger.error(`A daily update handler failed: ${jobErrorCode(error)}`);
        }
      }),
    );
  }
}
