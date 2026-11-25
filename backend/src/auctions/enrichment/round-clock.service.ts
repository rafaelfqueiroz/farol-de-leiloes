import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import { PropertyChangeService } from '../changes/property-change.service.js';
import type { ChangeDraft } from '../domain/change-types.js';
import { clockChanges } from '../domain/clock-changes.js';
import { EnrichmentRepository } from './enrichment.repository.js';

/** Properties read, judged and written together. */
export const CLOCK_CHUNK_SIZE = 200;

/**
 * SPEC-004 BR-004-13, BR-004-25, BR-004-26 (DL-004-06, DL-004-07): the changes the CLOCK makes.
 * An SFI auction moves from its 1st to its 2nd round when the 1st round's date passes, with no
 * list and no page saying so, yet its current minimum price and discount change. The daily run
 * compares, for every available property with a round already past, the round that is current NOW
 * (Brasília clock, `currentRound`) with the round recorded on the property when it was last
 * looked at, and records MODALITY_OR_ROUND_CHANGED / PRICE_DROPPED with source CLOCK, so the Radar
 * and the digest see what the search page already shows. No new cron: it runs inside the daily
 * update, before it completes (BR-004-23).
 *
 * Idempotent and resumable: per chunk the entries are recorded FIRST (unique run + property + field +
 * type), then the property's recorded round moves, guarded by the value the clock read. A run
 * that is repeated finds every recorded round equal to the current one and adds nothing; a run
 * that died between the two writes records the same entries again and moves the round.
 */
@Injectable()
export class RoundClockService {
  private readonly logger = new Logger(RoundClockService.name);

  constructor(
    private readonly properties: EnrichmentRepository,
    private readonly changes: PropertyChangeService,
    private readonly clock: Clock, // AR-24
  ) {}

  /** Returns how many change entries this call recorded (repeats of earlier ones included). */
  async record(input: {
    importRunId: string;
    /** Called before each chunk: it throws when the worker lost the run's lease. */
    assertHeld: () => Promise<void>;
  }): Promise<number> {
    const now = this.clock.now();
    let after: string | null = null;
    let recorded = 0;
    for (;;) {
      await input.assertHeld();
      const chunk = await this.properties.findClockCandidates(now, after, CLOCK_CHUNK_SIZE);
      const last = chunk[chunk.length - 1];
      if (last === undefined) break;

      const entries: ChangeDraft[] = [];
      const moves: { code: string; expected: string | null | undefined; label: string | null }[] =
        [];
      for (const candidate of chunk) {
        const outcome = clockChanges(
          candidate.code,
          { recordedLabel: candidate.currentRoundLabel, rounds: candidate.rounds },
          now,
        );
        entries.push(...outcome.entries);
        if (outcome.label !== undefined) {
          moves.push({
            code: candidate.code,
            expected: candidate.currentRoundLabel,
            label: outcome.label,
          });
        }
      }
      await this.changes.recordUnlessRepeated(input.importRunId, entries, now);
      for (const move of moves) {
        await this.properties.setCurrentRoundLabel(move.code, move.expected, move.label);
      }
      recorded += entries.length;
      after = last.code;
    }
    if (recorded > 0) this.logger.log(`The clock recorded ${recorded} round change entries`);
    return recorded;
  }
}
