import { Injectable } from '@nestjs/common';
import { PropertyChangeService } from '../changes/property-change.service.js';
import type { ChangeDraft } from '../domain/change-types.js';
import type { DetailPage } from '../domain/detail-data.js';
import { clockChanges } from '../domain/clock-changes.js';
import { diffDetails } from '../domain/detail-diff.js';
import { currentRound, roundsFromPhaseDates } from '../domain/rounds.js';
import {
  type CollectionWrite,
  EnrichmentRepository,
  type StoredForCollection,
} from './enrichment.repository.js';
import type { PropertyCopies } from './property-copier.js';

/**
 * SPEC-004 BR-004-11, BR-004-15, BR-004-25, BR-004-26: applies what a detail page said to its
 * property, and records what changed.
 *
 *  - Only what the page STATED is written: a field it does not state keeps its stored value, and
 *    stays unknown if there was none (BR-004-15). Nothing is ever defaulted.
 *  - The change entries are recorded BEFORE the property is written (as the list apply does): a
 *    crash in between leaves entries whose change the retry applies and records again, as the same
 *    entries (unique run + property + field + type, BR-004-07).
 *  - An entry needs a KNOWN old value: the first collection of a property records none (see
 *    `diffDetails`), so a new property never "started accepting financing".
 */
@Injectable()
export class DetailApplier {
  constructor(
    private readonly changes: PropertyChangeService,
    private readonly properties: EnrichmentRepository,
  ) {}

  /** Returns how many change entries the collection recorded. */
  async apply(input: {
    runId: string;
    stored: StoredForCollection;
    page: DetailPage;
    copies: PropertyCopies;
    now: Date;
  }): Promise<number> {
    const { runId, stored, page, copies, now } = input;

    // The rounds follow the modality the LIST gave (the page does not name it). A modality that
    // needs dates and a page without them: no rounds, the stored ones stay (unknown never replaces).
    const rounds =
      stored.modality === null
        ? []
        : roundsFromPhaseDates(stored.modality, page.phaseDates, page.prices);

    // BR-004-13, BR-004-26: the collection moves the recorded round (below). If the clock had not
    // yet looked at the property today, the move it is about to hide (the 1st round ended since the
    // last look) is recorded HERE, as the clock would have, under the same unique key: the clock
    // step that follows then finds the round equal and adds nothing.
    const clock = clockChanges(
      stored.code,
      { recordedLabel: stored.currentRoundLabel, rounds: stored.rounds },
      now,
    );
    const entries: ChangeDraft[] = [
      ...clock.entries,
      ...diffDetails(
        stored.code,
        { rounds: stored.rounds, paymentMethods: stored.paymentMethods },
        { rounds, paymentMethods: page.paymentMethods },
        now,
      ),
      ...copies.entries,
    ];

    const write: CollectionWrite = {
      now,
      phaseCount: stored.phaseCount,
      newVersions: copies.newVersions,
      touch: entries.length > 0 || stored.detailsCollectedAt === null,
    };
    if (page.description !== null && page.description !== '') write.description = page.description;
    if (page.propertyType !== null) write.propertyType = page.propertyType;
    if (page.occupancy !== null) write.occupancy = page.occupancy;
    if (rounds.length > 0) {
      write.rounds = rounds;
      write.currentRoundLabel = currentRound(rounds, now)?.label ?? null;
      write.phaseDates = page.phaseDates;
    } else if (clock.label !== undefined) {
      write.currentRoundLabel = clock.label; // the rounds stay as stored: the move still counts
    }
    if (page.paymentMethods !== null) write.paymentMethods = page.paymentMethods;
    if (page.expenseRules !== null) write.expenseRules = page.expenseRules;
    if (copies.photos !== undefined) write.photos = copies.photos;
    if (copies.edital !== undefined) write.edital = copies.edital;
    if (copies.matricula !== undefined) write.matricula = copies.matricula;

    await this.changes.recordUnlessRepeated(runId, entries, now);
    await this.properties.applyCollection(stored.code, write);
    for (const check of copies.checked) {
      await this.properties.markVersionChecked(stored.code, check, now);
    }
    return entries.length;
  }
}
