// TS-03: a hand-written fake of the SPEC-017 seam the retention job reads (SPEC-010 BR-010-18..21). It
// keeps closed journeys in memory with a file count each, lists them oldest first like the contract
// says, and can be told to ignore the cutoff (a source that filters wrongly), to fail a journey, or
// to wait inside `purgeFiles` (a run in progress, for the lock specs). It obeys the contract: a journey
// stays listed until `acknowledgePurged`, `purgeFiles` is idempotent (a repeat answers 0) and the
// ids a listing is told to exclude are left out.
import type {
  ClosedJourneyFilesSource,
  ClosedJourneyRef,
  ClosedKind,
  ListClosedJourneysOptions,
} from '../../src/privacy/retention/closed-journey-files.source.js';

export interface FakeJourney extends ClosedJourneyRef {
  files: number;
  /** True once the service acknowledged it: only then is it not listed any more. */
  purged: boolean;
}

let counter = 0;
/** A 24-hex ObjectId-shaped id, unique per call. */
export function hexId(): string {
  counter += 1;
  return counter.toString(16).padStart(24, '0');
}

export class FakeClosedJourneyFilesSource implements ClosedJourneyFilesSource {
  readonly journeys: FakeJourney[] = [];
  readonly listed: { cutoff: string; limit: number; excluded: number }[] = [];
  readonly purgeCalls: string[] = [];
  readonly acknowledged: string[] = [];
  /** Journeys whose acknowledgement throws. */
  readonly failingAcknowledge = new Set<string>();
  /** Lists every unpurged journey whatever the cutoff: a source that filters wrongly. */
  ignoreCutoff = false;
  /** Journeys whose purge throws (a storage fault). */
  readonly failing = new Set<string>();
  /** Awaited inside purgeFiles, to hold a run open. */
  hold: Promise<void> | undefined;

  add(
    closedOn: string,
    options: { files?: number; kind?: ClosedKind; ownerType?: string; ownerId?: string } = {},
  ): FakeJourney {
    const journey: FakeJourney = {
      journeyId: hexId(),
      ownerType: options.ownerType ?? 'office',
      ownerId: options.ownerId ?? hexId(),
      closedOn,
      closedKind: options.kind ?? 'won',
      files: options.files ?? 3,
      purged: false,
    };
    this.journeys.push(journey);
    return journey;
  }

  listClosedJourneys(
    cutoffClosedOn: string,
    limit: number,
    options: ListClosedJourneysOptions = {},
  ): Promise<ClosedJourneyRef[]> {
    const excluded = new Set(options.excludeJourneyIds ?? []);
    this.listed.push({ cutoff: cutoffClosedOn, limit, excluded: excluded.size });
    return Promise.resolve(
      this.journeys
        .filter(
          (j) =>
            !j.purged &&
            !excluded.has(j.journeyId) &&
            (this.ignoreCutoff || j.closedOn <= cutoffClosedOn),
        )
        .sort((a, b) => a.closedOn.localeCompare(b.closedOn))
        .slice(0, limit)
        .map((j) => ({
          journeyId: j.journeyId,
          ownerType: j.ownerType,
          ownerId: j.ownerId,
          closedOn: j.closedOn,
          closedKind: j.closedKind,
        })),
    );
  }

  async purgeFiles(journeyId: string): Promise<{ fileCount: number }> {
    this.purgeCalls.push(journeyId);
    if (this.hold) await this.hold;
    if (this.failing.has(journeyId)) throw new Error('storage unavailable for a secret.pdf');
    const journey = this.journeys.find((j) => j.journeyId === journeyId);
    if (!journey) return { fileCount: 0 };
    const fileCount = journey.files;
    journey.files = 0;
    return { fileCount };
  }

  acknowledgePurged(journeyId: string): Promise<void> {
    if (this.failingAcknowledge.has(journeyId)) return Promise.reject(new Error('source down'));
    const journey = this.journeys.find((j) => j.journeyId === journeyId);
    if (journey) journey.purged = true;
    this.acknowledged.push(journeyId);
    return Promise.resolve();
  }
}
