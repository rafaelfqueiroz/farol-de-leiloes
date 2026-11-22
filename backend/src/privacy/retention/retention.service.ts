// SPEC-010 BR-010-18..21, BR-010-24: the daily deletion of the documents of closed journeys whose
// retention ended. The rule is the pure domain/retention.ts; the files belong to SPEC-017 and are
// reached through CLOSED_JOURNEY_FILES_SOURCE; this service only orchestrates:
//
//   today (Brasília) -> candidates the source lists at or before today - N years, oldest first
//     -> RE-CHECK each: a known closing kind, a plausible closing date, and isDueForPurge (the
//        source's filter and its "closed journeys only" are never trusted)
//     -> source.purgeFiles(journeyId)  (idempotent)
//     -> one `retentionDeletions` row (a duplicate means it is already logged: success)
//     -> source.acknowledgePurged(journeyId)  (only now does the source stop listing it).
//
// A crash anywhere before the acknowledgement is repaired by the next run: the journey is listed
// again, purgeFiles repeats (answers 0, so the logged count may undercount) and the duplicate row is
// success. A failing journey leaves no row and is excluded from the rest of the run.
//
// SAFETY BRAKE: lowering DOCUMENT_RETENTION_YEARS deletes irreversibly at the next run. When the
// setting is shorter than the period the lawyer's newest retention validation reviewed, or no
// validation exists yet (provisional), a run deletes at most UNVALIDATED_RUN_CAP journeys and warns,
// so an operator notices before everything goes. Raising the period never needs it. The budget counts
// DESTRUCTIVE ATTEMPTS, not logged successes: a journey is counted BEFORE `purgeFiles` runs, whatever
// happens to its log row or its acknowledgement afterwards, so a log that is down (or a source that
// cannot acknowledge) can never turn a cap of 25 into an unbounded deletion.
//
// Logs and results are counts only (SC-15, BR-010-21), except that a journey outside the source's
// contract is named by its id so the source's defect can be found.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { brasiliaToday } from '../../common/clock/brasilia-time.js';
import { Clock } from '../../common/clock/clock.js';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import businessConfig from '../../config/business.config.js';
import {
  closedOnCutoff,
  closingProblem,
  InvalidRetentionInputError,
  isDueForPurge,
  retentionReview,
  type RetentionReview,
  UNVALIDATED_RUN_CAP,
} from '../domain/retention.js';
import { LegalValidationsRepository } from '../legal-validation/legal-validations.repository.js';
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
  /**
   * Journeys whose files this run set out to delete (`purgeFiles` was called): the number the safety
   * brake counts, whatever became of the log row or the acknowledgement afterwards (BR-010-24).
   */
  readonly attempted: number;
  /** Journeys whose files were deleted this run and whose deletion is logged. */
  readonly deleted: number;
  /** Files those deletions removed. */
  readonly files: number;
  /**
   * Journeys the source listed that it must not have: closed after the cutoff it was given and not
   * due, with an unknown closing kind, or with an implausible closing date (before 2020-01-01 or in
   * the future). They are left alone. (A journey closed exactly on the cutoff may be listed and not
   * due, the last day of its retention: that is normal and not counted.)
   */
  readonly outOfContract: number;
  /** Journeys that failed this run and stay candidates for the next one. */
  readonly failed: number;
  /** Of the failed: files gone but the log row could not be written. */
  readonly unrecorded: number;
  /** The run stopped at UNVALIDATED_RUN_CAP journeys (the period is lowered or not validated). */
  readonly capped: boolean;
  readonly review: RetentionReview;
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @Inject(CLOSED_JOURNEY_FILES_SOURCE) private readonly source: ClosedJourneyFilesSource,
    private readonly deletions: RetentionDeletionsRepository,
    private readonly validations: LegalValidationsRepository,
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
    const review = await this.review(years);
    const cap = review === 'validated' ? Number.POSITIVE_INFINITY : UNVALIDATED_RUN_CAP;
    let attempted = 0;
    let deleted = 0;
    let files = 0;
    let unrecorded = 0;
    let capped = false;
    let warned = false;
    // Journeys not to ask for again in this run: they come back at the head of every listing, so the
    // source is told to leave them out and the ones behind them are reached.
    const handled = new Set<string>();
    const outOfContract = new Set<string>();
    const failed = new Set<string>();

    batches: for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch += 1) {
      const candidates = await this.source.listClosedJourneys(cutoff, RETENTION_BATCH_SIZE, {
        excludeJourneyIds: [...handled],
      });
      const fresh = candidates.filter((journey) => !handled.has(journey.journeyId));
      if (fresh.length === 0) break;
      if (review !== 'validated' && !warned) {
        warned = true;
        this.logger.warn(
          review === 'lowered'
            ? `DOCUMENT_RETENTION_YEARS (${years}) is shorter than the period the lawyer validated: ` +
                `this run deletes at most ${UNVALIDATED_RUN_CAP} journeys (BR-010-24)`
            : `The retention period (${years} years) is not validated yet (provisional): this run ` +
                `deletes at most ${UNVALIDATED_RUN_CAP} journeys (BR-010-24)`,
        );
      }
      for (const journey of fresh) {
        // The brake spends on attempts, never on logged successes (BR-010-24).
        if (attempted >= cap) {
          capped = true;
          break batches;
        }
        handled.add(journey.journeyId);
        try {
          const problem = closingProblem(journey.closedOn, journey.closedKind, today);
          if (problem !== null) {
            outOfContract.add(journey.journeyId);
            // The id only: what the operator needs to find the source's defect, never content.
            this.logger.warn(
              `The files source listed journey ${journey.journeyId} outside its contract (${problem}); not purged`,
            );
            continue;
          }
          // The source's filter is a convenience; this check is the rule (BR-010-19).
          if (!isDueForPurge(today, journey.closedOn, years)) {
            if (journey.closedOn > cutoff) outOfContract.add(journey.journeyId);
            continue;
          }
          // Before any file goes: a log row for an id that is not an ObjectId could never be written.
          if (!OBJECT_ID.test(journey.journeyId) || !OBJECT_ID.test(journey.ownerId)) {
            throw new InvalidRetentionInputError('a journey or owner id is not an ObjectId');
          }
          // Counted BEFORE the call: the files may be gone even when the call, the log row or the
          // acknowledgement then fails, and the cap exists to bound exactly that.
          attempted += 1;
          const { fileCount } = await this.source.purgeFiles(journey.journeyId);
          if (!(await this.logDeletion(journey, fileCount))) {
            failed.add(journey.journeyId);
            unrecorded += 1;
            continue;
          }
          deleted += 1;
          files += fileCount;
          // Only now may the source stop listing it. A failure leaves it listed: tomorrow's repeat
          // finds nothing to delete, the row is a duplicate (success) and the acknowledgement retries.
          try {
            await this.source.acknowledgePurged(journey.journeyId);
          } catch (error) {
            failed.add(journey.journeyId);
            this.logger.warn(
              `A deletion could not be acknowledged to the files source: ${jobErrorCode(error)}`,
            );
          }
        } catch (error) {
          failed.add(journey.journeyId);
          // SC-15: the failure's code only, never the journey, never the source's message.
          this.logger.warn(
            `A journey's documents could not be deleted this time: ${jobErrorCode(error)}`,
          );
        }
      }
      if (candidates.length < RETENTION_BATCH_SIZE) break;
    }
    return {
      attempted,
      deleted,
      files,
      outOfContract: outOfContract.size,
      failed: failed.size,
      unrecorded,
      capped,
      review,
    };
  }

  /**
   * How the setting stands against the lawyer's newest retention validation. Reading it is
   * best-effort: when it cannot be read the run is treated as unvalidated (capped), never as safe.
   */
  private async review(years: number): Promise<RetentionReview> {
    try {
      const [newest] = await this.validations.newestOfScope('retention-periods');
      return retentionReview(
        years,
        newest === undefined ? undefined : (newest.retentionYears ?? null),
      );
    } catch (error) {
      this.logger.warn(`The retention validation could not be read: ${jobErrorCode(error)}`);
      return 'provisional';
    }
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
