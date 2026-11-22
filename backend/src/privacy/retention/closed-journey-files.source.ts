// SPEC-010 BR-010-18..21: the seam through which the retention job reaches the files of closed
// journeys. SPEC-017 (the journey documents and photos) OWNS the storage and plugs its own
// implementation into CLOSED_JOURNEY_FILES_SOURCE at the one place it is bound
// (PrivacyRetentionModule); it holds no retention setting of its own. SPEC-010 owns the clock
// (domain/retention.ts), the setting (DOCUMENT_RETENTION_YEARS) and the log (`retentionDeletions`).
//
// Until SPEC-017 binds a real source, the default lists no journey, so the job finds nothing.
// Documents of a journey that is not closed are on no clock (BR-010-19): a source lists CLOSED
// journeys only.
import type { ClosedKind } from '../domain/retention.js';

export type { ClosedKind };

/** A closed journey whose files may be due for deletion. Ids are ObjectId hex strings. */
export interface ClosedJourneyRef {
  readonly journeyId: string;
  /** The journey's owner (AR-11), recorded in the log as ids only. */
  readonly ownerType: string;
  readonly ownerId: string;
  /** The Brasília calendar day the journey closed on, `YYYY-MM-DD` (AR-22, SPEC-003 BR-003-26). */
  readonly closedOn: string;
  readonly closedKind: ClosedKind;
}

/** What a listing is told besides the cutoff. */
export interface ListClosedJourneysOptions {
  /**
   * Journeys the service already handled in this run (failed, or outside the contract): the source
   * MUST NOT return them, so a head of journeys that keep failing never hides the ones behind it.
   */
  readonly excludeJourneyIds?: readonly string[];
}

export interface ClosedJourneyFilesSource {
  /**
   * Closed journeys whose `closedOn` is at or before `cutoffClosedOn`, OLDEST `closedOn` first, at
   * most `limit`, without those in `options.excludeJourneyIds`. A journey MUST stay listed until
   * `acknowledgePurged` is called for it: that is what makes a crash between the deletion and the log
   * row repairable (the next run lists it again). The cutoff is a convenience for the query, never
   * the rule: the retention service re-checks every result (the clock, a known closing kind, a
   * plausible closing date) and never purges one that fails, so a source that lists a journey that
   * is not due, or not closed, gets nothing deleted. Account deletion does not remove a journey from
   * the list (BR-010-20).
   */
  listClosedJourneys(
    cutoffClosedOn: string,
    limit: number,
    options?: ListClosedJourneysOptions,
  ): Promise<ClosedJourneyRef[]>;

  /**
   * Deletes every file (documents and photos) of the journey for good and answers how many files THIS
   * call deleted. MUST be idempotent: the service calls it again for a journey it has not
   * acknowledged (a crash between the deletion and the log row, a failed acknowledgement), and a
   * repeat finds nothing left and answers 0. Consequence, accepted: after such a crash the logged
   * `fileCount` is the repeat's 0 and undercounts what the first call deleted. It must NOT make the
   * journey stop being listed: only `acknowledgePurged` does. Document content and file names never
   * leave the source (BR-010-21): the service only receives the count.
   */
  purgeFiles(journeyId: string): Promise<{ fileCount: number }>;

  /**
   * The service calls this only AFTER the `retentionDeletions` row of the journey exists (a duplicate
   * row counts as written). From then on the journey is not listed again. Idempotent.
   */
  acknowledgePurged(journeyId: string): Promise<void>;
}

/** DI token; the default binding is in PrivacyRetentionModule, SPEC-017 replaces it there. */
export const CLOSED_JOURNEY_FILES_SOURCE = Symbol('CLOSED_JOURNEY_FILES_SOURCE');

/** Before SPEC-017: no journey has files, so nothing is listed and nothing is deleted. */
export class NoClosedJourneyFilesSource implements ClosedJourneyFilesSource {
  listClosedJourneys(): Promise<ClosedJourneyRef[]> {
    return Promise.resolve([]);
  }

  purgeFiles(): Promise<{ fileCount: number }> {
    return Promise.resolve({ fileCount: 0 });
  }

  acknowledgePurged(): Promise<void> {
    return Promise.resolve();
  }
}
