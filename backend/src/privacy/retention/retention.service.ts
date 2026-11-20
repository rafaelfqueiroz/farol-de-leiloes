// SPEC-010 BR-010-18..21, BR-010-24: the daily deletion of the documents of closed journeys whose
// retention ended. The rule is the pure domain/retention.ts; the files belong to SPEC-017 and are
// reached through CLOSED_JOURNEY_FILES_SOURCE; this service only orchestrates:
//
//   today (Brasília) -> candidates the source lists at or before today - N years, oldest first
//     -> RE-CHECK each with isDueForPurge (the source's filter is never trusted)
//     -> source.purgeFiles(journeyId)  (idempotent)
//     -> one `retentionDeletions` row (a duplicate means it is already logged: success).
//
// A failing journey is left out and retried by the next run; it leaves no row. Logs and results are
// counts only (SC-15, BR-010-21): no journey id, owner or file name is logged here.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { brasiliaToday } from '../../common/clock/brasilia-time.js';
import { Clock } from '../../common/clock/clock.js';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import businessConfig from '../../config/business.config.js';
import { closedOnCutoff, InvalidRetentionInputError, isDueForPurge } from '../domain/retention.js';
import {
  CLOSED_JOURNEY_FILES_SOURCE,
  type ClosedJourneyFilesSource,
  type ClosedJourneyRef,
} from './closed-journey-files.source.js';
import { RetentionDeletionsRepository } from './retention-deletions.repository.js';

const OBJECT_ID = /^[0-9a-f]{24}$/;

/** Journeys one listing asks for. */
export const RETENTION_BATCH_SIZE = 100;
/** Listings per run: a run deletes at most this many batches' worth (the rest waits for tomorrow). */
export const RETENTION_MAX_BATCHES = 50;
/** Attempts at writing the log row after the files are gone (a transient database error). */
export const RETENTION_LOG_ATTEMPTS = 3;

/** What one run did, as counts. */
export interface RetentionOutcome {
  /** Journeys whose files were deleted this run and whose deletion is logged. */
  readonly deleted: number;
  /** Files those deletions removed. */
  readonly files: number;
  /**
   * Journeys the source listed that are not due yet AND closed after the cutoff it was given: the
   * source broke its contract. They are left alone. (A journey closed exactly on the cutoff may be
   * listed and not due, the last day of its retention: that is normal and not counted.)
   */
  readonly notDue: number;
  /** Journeys that failed this run and stay candidates for the next one. */
  readonly failed: number;
  /** Of the failed: files gone but the log row could not be written. */
  readonly unrecorded: number;
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @Inject(CLOSED_JOURNEY_FILES_SOURCE) private readonly source: ClosedJourneyFilesSource,
    private readonly deletions: RetentionDeletionsRepository,
    private readonly clock: Clock, // AR-24
    @Inject(businessConfig.KEY) private readonly config: ConfigType<typeof businessConfig>,
  ) {}

  /**
   * One pass over everything due today. It does not lock or record a job execution (the job does);
   * a journey's failure is counted, not thrown, so the others still go. Throws only when the source
   * cannot even list.
   */
  async purgeDue(): Promise<RetentionOutcome> {
    const years = this.config.privacy.documentRetentionYears;
    const today = brasiliaToday(this.clock); // the Brasília calendar day, never the UTC one
    const cutoff = closedOnCutoff(today, years);
    let deleted = 0;
    let files = 0;
    let unrecorded = 0;
    // Journeys not to try again in this run: they come back at the head of every listing.
    const notDue = new Set<string>();
    const outOfContract = new Set<string>();
    const failed = new Set<string>();

    for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch += 1) {
      const candidates = await this.source.listClosedJourneys(cutoff, RETENTION_BATCH_SIZE);
      if (candidates.length === 0) break;
      let progressed = false;
      for (const journey of candidates) {
        if (notDue.has(journey.journeyId) || failed.has(journey.journeyId)) continue;
        try {
          // The source's filter is a convenience; this check is the rule (BR-010-19).
          if (!isDueForPurge(today, journey.closedOn, years)) {
            notDue.add(journey.journeyId);
            if (journey.closedOn > cutoff) outOfContract.add(journey.journeyId);
            continue;
          }
          // Before any file goes: a log row for an id that is not an ObjectId could never be written.
          if (!OBJECT_ID.test(journey.journeyId) || !OBJECT_ID.test(journey.ownerId)) {
            throw new InvalidRetentionInputError('a journey or owner id is not an ObjectId');
          }
          const { fileCount } = await this.source.purgeFiles(journey.journeyId);
          if (!(await this.logDeletion(journey, fileCount))) {
            failed.add(journey.journeyId);
            unrecorded += 1;
            continue;
          }
          deleted += 1;
          files += fileCount;
          progressed = true;
        } catch (error) {
          failed.add(journey.journeyId);
          // SC-15: the failure's code only, never the journey, never the source's message.
          this.logger.warn(
            `A journey's documents could not be deleted this time: ${jobErrorCode(error)}`,
          );
        }
      }
      // The ones that failed or are not due come back at the head of the next listing: stop when
      // a whole batch deleted nothing, instead of asking again for the same journeys.
      if (!progressed || candidates.length < RETENTION_BATCH_SIZE) break;
    }
    return { deleted, files, notDue: outOfContract.size, failed: failed.size, unrecorded };
  }

  /**
   * Writes the log row once the files are gone (BR-010-21). A duplicate is success: the deletion is
   * already logged. A transient failure is retried; false when the row still could not be written
   * (the files ARE gone: the run reports it).
   */
  private async logDeletion(
    journey: Pick<ClosedJourneyRef, 'journeyId' | 'ownerType' | 'ownerId'>,
    fileCount: number,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= RETENTION_LOG_ATTEMPTS; attempt += 1) {
      try {
        await this.deletions.insert({
          journeyId: journey.journeyId,
          journeyOwnerType: journey.ownerType,
          journeyOwnerId: journey.ownerId,
          fileCount,
          deletedAt: this.clock.now(),
        });
        return true;
      } catch (error) {
        this.logger.warn(
          `The retention log row could not be written (attempt ${attempt}): ${jobErrorCode(error)}`,
        );
      }
    }
    return false;
  }
}
