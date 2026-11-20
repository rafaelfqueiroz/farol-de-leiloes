// SPEC-010 BR-010-18..21: the seam through which the retention job reaches the files of closed
// journeys. SPEC-017 (the journey documents and photos) OWNS the storage and plugs its own
// implementation into CLOSED_JOURNEY_FILES_SOURCE at the one place it is bound
// (PrivacyRetentionModule); it holds no retention setting of its own. SPEC-010 owns the clock
// (domain/retention.ts), the setting (DOCUMENT_RETENTION_YEARS) and the log (`retentionDeletions`).
//
// Until SPEC-017 binds a real source, the default lists no journey, so the job finds nothing.
// Documents of a journey that is not closed are on no clock (BR-010-19): a source lists CLOSED
// journeys only.

/** How a journey ended. The kind never changes the rule: lost and cancelled count like won (D-41). */
export type ClosedKind = 'won' | 'lost' | 'cancelled';

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

export interface ClosedJourneyFilesSource {
  /**
   * Closed journeys whose `closedOn` is at or before `cutoffClosedOn` and whose files have not been
   * deleted yet, OLDEST `closedOn` first, at most `limit`. The cutoff is a convenience for the
   * query, never the rule: the retention service re-checks every result with `isDueForPurge`, so a
   * source that returns a journey not yet due does not get it purged. A journey that is still open
   * is never listed. Account deletion does not remove a journey from the list (BR-010-20).
   */
  listClosedJourneys(cutoffClosedOn: string, limit: number): Promise<ClosedJourneyRef[]>;

  /**
   * Deletes every file (documents and photos) of the journey for good and answers how many files THIS
   * call deleted. MUST be idempotent: the service may call it again for the same journey (a run that
   * died between the deletion and the log row, two replicas whose lock expired), and a repeat finds
   * nothing left and answers 0. It must not stop listing a journey on its own before it returned:
   * until then the journey stays a candidate. Document content and file names never leave the source
   * (BR-010-21): the service only receives the count.
   */
  purgeFiles(journeyId: string): Promise<{ fileCount: number }>;
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
}
