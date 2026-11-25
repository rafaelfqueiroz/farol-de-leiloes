// SPEC-004 BR-004-01..04, BR-004-10, BR-004-23, BR-004-29, BR-004-31: what the daily import does at
// a given moment, decided from the persisted state of the day's Import Run and nothing else. Pure
// (AR-05): "now", the settings and the business-day question arrive as arguments, so the whole
// state machine is a table of hand-computed instants. The orchestrator (importer/import-orchestrator)
// only carries the decision out, under the run's lease.
//
// The day. One run per Brasília calendar day, keyed when the run is created: a run that crosses
// midnight keeps its date, and its window and cutoff are the date's, not today's.
//
//   before the window start            no attempt
//   window start <= now < cutoff        attempts, `attemptSpacingMinutes` apart, at most `maxAttempts`
//   now >= cutoff                       no attempt; the day is decided at the first tick from here on
//
// The run is RUNNING until it is decided. A day nobody attempted by the cutoff is decided at the
// first tick after it, on a business day, as FAILED NO_ATTEMPT (nothing looked at, nobody told:
// the admins must hear); on a weekend or holiday it leaves nothing. Decided early (before the cutoff) only when nothing a
// later attempt could do changes the outcome: Caixa blocked us, or the attempts ran out on a day
// that already ends FAILED or REJECTED_LIST. A day that ends NO_NEW_LIST / NO_UPDATE is decided at
// the cutoff ("by the daily cutoff", BR-004-03), whatever the attempts used.
import { brasiliaWallClockToInstant } from '../../common/clock/brasilia-time.js';
import { parseCalendarDate } from '../../common/domain/business-day.js';

/** The settings of BusinessConfig.import the schedule reads. */
export interface ImportSchedule {
  /** Minutes after midnight in Brasília: no attempt before it. */
  windowStartMinutes: number;
  /** Minutes after midnight in Brasília: no attempt from it on; the day is decided. */
  cutoffMinutes: number;
  maxAttempts: number;
  attemptSpacingMinutes: number;
}

/** What the schedule asks of the calendar (BusinessCalendar answers it). */
export interface DayCalendar {
  isBusinessDay(brasiliaDate: string): boolean;
  /** Why a non-business day is one; null for a business day. */
  nonBusinessReason(brasiliaDate: string): NonBusinessReason | null;
}

export type NonBusinessReason = 'WEEKEND' | 'HOLIDAY';

/** The outcomes a run is decided with (the schema's, minus the open and the success ones). */
export type DecidedOutcome = 'FAILED' | 'REJECTED_LIST' | 'NO_NEW_LIST' | 'NO_UPDATE';

/** What the run remembers of the day so far. Plain data: no row, no message (SC-15). */
export interface RunProgress {
  /** Some attempt got a list from Caixa (a newer one or not): Caixa was reachable. */
  listReached: boolean;
  /** A validated list is being applied, or was when the process died: the next attempt resumes it from the stored copy. */
  applying: boolean;
  /** The last apply of a validated list failed (its error class is in the failure reasons). */
  applyFailed: boolean;
  /** The newest list the validator refused: its generation day (null: unreadable) and the code. */
  rejection: { generatedOn: string | null; reason: string } | null;
  /**
   * Caixa answered a request of the day with a block (`HTTP_403`, `CHALLENGE_PAGE`...): the reason
   * code, null when it never did. A run that carries one is decided at once and asks Caixa for
   * nothing more that day, whatever else it says (BR-004-20, SC-24).
   */
  blocked: string | null;
}

export interface RunState {
  /** `YYYY-MM-DD`: the day the run was created for (AR-22). */
  brasiliaDate: string;
  /** RUNNING while undecided; SUCCESS once a list was applied; anything else is final. */
  outcome: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'REJECTED_LIST' | 'NO_NEW_LIST' | 'NO_UPDATE';
  attempts: number;
  nextAttemptAt: Date | null;
  /** Set exactly once, when the daily update is complete (BR-004-23). */
  updateCompletedAt: Date | null;
  progress: RunProgress;
}

export type WaitReason =
  'BEFORE_WINDOW' | 'AFTER_CUTOFF' | 'SPACING' | 'ATTEMPTS_EXHAUSTED' | 'FINISHED';

export type ImportDecision =
  | { kind: 'wait'; reason: WaitReason }
  /** `resume`: a validated list was being applied; `search`: look for a new list. */
  | { kind: 'attempt'; mode: 'search' | 'resume' }
  /** The list is applied; run the collection pass and complete the update (BR-004-23). */
  | { kind: 'collect' }
  | {
      kind: 'finalize';
      outcome: DecidedOutcome;
      /** The code recorded and alerted on. */
      reason: string;
      /** For NO_UPDATE: why the day is not a business day (BR-004-03). */
      nonBusinessReason: NonBusinessReason | null;
    };

/** The instant `minutes` after midnight in Brasília on `brasiliaDate` (AR-23: the zone, no offset). */
export function brasiliaInstant(brasiliaDate: string, minutes: number): Date {
  const parts = parseCalendarDate(brasiliaDate);
  if (parts === null) throw new RangeError('A calendar day must be a real YYYY-MM-DD date');
  return brasiliaWallClockToInstant({
    ...parts,
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}

/** The first instant of the day with no more attempts (BR-004-03). */
export function cutoffInstant(brasiliaDate: string, schedule: ImportSchedule): Date {
  return brasiliaInstant(brasiliaDate, schedule.cutoffMinutes);
}

/** The first instant of the day with attempts (BR-004-01). */
export function windowStartInstant(brasiliaDate: string, schedule: ImportSchedule): Date {
  return brasiliaInstant(brasiliaDate, schedule.windowStartMinutes);
}

/**
 * When the attempt after one that began at `startedAt` is due: its minute, plus the spacing. The
 * minute, not the millisecond: the ticks run on the minute, and an attempt that began a few
 * milliseconds late must not push the next one to the following tick (BR-004-02).
 */
export function nextAttemptDue(startedAt: Date, spacingMinutes: number): Date {
  const minute = 60_000;
  return new Date(Math.floor(startedAt.getTime() / minute) * minute + spacingMinutes * minute);
}

/** The code of a day that never got a list from Caixa: no attempt got an answer (BR-004-03). */
export const LIST_UNREACHABLE = 'LIST_UNREACHABLE';
/** The code of a day Caixa blocked (BR-004-20): stop for the day. */
export const LIST_BLOCKED = 'LIST_BLOCKED';
/** A day decided with no attempt recorded at all (the process died before the first one counted). */
export const NO_ATTEMPT = 'NO_ATTEMPT';
/** The code of a business day with no new list (BR-004-03). */
export const NO_NEW_LIST_CODE = 'NO_NEW_LIST';
/** The code of a day whose validated list could not be applied; the error class follows it. */
export const APPLY_FAILED = 'APPLY_FAILED';

/**
 * How a run that applied no list ends when the day is decided (BR-004-03, BR-004-10):
 *
 *  1. a validated list that could not be applied (it threw, or the process died while applying
 *     and the day ran out before a retry could finish it) -> FAILED (the apply is what failed);
 *  2. a list was published and refused            -> REJECTED_LIST with the validator's code;
 *  3. Caixa answered with a list that is not new  -> business day NO_NEW_LIST (a failure),
 *     weekend or holiday NO_UPDATE (not a failure: Caixa publishes nothing then);
 *  4. otherwise Caixa never answered              -> FAILED, whatever the day ("cannot be reached
 *     at all"; a weekend is no excuse for silence).
 *
 * "Reachable" means some attempt of the day got a list: one timeout among answers does not turn a
 * quiet Sunday into a failure.
 */
export function endOfDay(
  run: Pick<RunState, 'attempts' | 'progress' | 'brasiliaDate'>,
  calendar: DayCalendar,
): Extract<ImportDecision, { kind: 'finalize' }> {
  const { progress } = run;
  if (progress.applyFailed || progress.applying) {
    return finalize('FAILED', APPLY_FAILED);
  }
  if (progress.rejection !== null) {
    return finalize('REJECTED_LIST', progress.rejection.reason);
  }
  if (progress.listReached) {
    if (calendar.isBusinessDay(run.brasiliaDate)) return finalize('NO_NEW_LIST', NO_NEW_LIST_CODE);
    return finalize('NO_UPDATE', NO_NEW_LIST_CODE, calendar.nonBusinessReason(run.brasiliaDate));
  }
  return finalize('FAILED', run.attempts > 0 ? LIST_UNREACHABLE : NO_ATTEMPT);
}

function finalize(
  outcome: DecidedOutcome,
  reason: string,
  nonBusinessReason: NonBusinessReason | null = null,
): Extract<ImportDecision, { kind: 'finalize' }> {
  return { kind: 'finalize', outcome, reason, nonBusinessReason };
}

/** A decided run that an early decision may close: nothing a later attempt does would change it. */
function endsAsFailure(decision: Extract<ImportDecision, { kind: 'finalize' }>): boolean {
  return decision.outcome === 'FAILED' || decision.outcome === 'REJECTED_LIST';
}

/**
 * What to do now for the day `brasiliaDate`, given its run (null: none yet).
 *
 *  - no run: attempt when the window is open and the cutoff has not come; before the window wait.
 *    From the cutoff on, a business day nobody attempted is decided FAILED NO_ATTEMPT; a weekend
 *    or holiday is left alone;
 *  - SUCCESS: complete the update (collection pass, then the signal) until it is done;
 *  - decided (FAILED, REJECTED_LIST, NO_NEW_LIST, NO_UPDATE): nothing, ever;
 *  - RUNNING with a recorded block: decided FAILED LIST_BLOCKED at once, at any time of day;
 *  - RUNNING: at the cutoff, decide the day (`endOfDay`); before it, decide early when the
 *    attempts are used up on a day that ends FAILED or REJECTED_LIST; else attempt when the window
 *    is open and the spacing since the last attempt has passed. An attempt on a run whose list was
 *    being applied is a `resume` (it reads the stored copy of that list and never asks Caixa,
 *    SC-24); it obeys the spacing, the attempt cap and the cutoff like any other attempt. A list
 *    still "being applied" when the day is decided is an apply that failed (`endOfDay`).
 */
export function decideNextAction(
  state: { brasiliaDate: string; run: RunState | null },
  now: Date,
  schedule: ImportSchedule,
  calendar: DayCalendar,
): ImportDecision {
  const { brasiliaDate, run } = state;
  const windowOpen = now.getTime() >= windowStartInstant(brasiliaDate, schedule).getTime();
  const pastCutoff = now.getTime() >= cutoffInstant(brasiliaDate, schedule).getTime();

  if (run === null) {
    if (!windowOpen) return { kind: 'wait', reason: 'BEFORE_WINDOW' };
    if (!pastCutoff) return { kind: 'attempt', mode: 'search' };
    // Nobody attempted the day (the process was down, or the import was switched off): on a
    // business day that is a failure the admins must hear of (BR-004-03, BR-004-29); on a weekend
    // or holiday nothing was expected, and "no update" needs Caixa to have been reached.
    return calendar.isBusinessDay(brasiliaDate)
      ? finalize('FAILED', NO_ATTEMPT)
      : { kind: 'wait', reason: 'AFTER_CUTOFF' };
  }
  if (run.outcome === 'SUCCESS') {
    return run.updateCompletedAt === null
      ? { kind: 'collect' }
      : { kind: 'wait', reason: 'FINISHED' };
  }
  if (run.outcome !== 'RUNNING') return { kind: 'wait', reason: 'FINISHED' };
  // BR-004-20, SC-24, AR-03: a recorded block ends the day before anything else is looked at: not
  // the window, the spacing, the attempts, nor the cutoff may send another request. Recovery of a
  // run whose finalization did not complete (it stays RUNNING with the block on it) lands here.
  if (run.progress.blocked !== null) return finalize('FAILED', LIST_BLOCKED);
  const decided = endOfDay(run, calendar);
  if (pastCutoff) return decided;
  const exhausted = run.attempts >= schedule.maxAttempts;
  if (exhausted) {
    return endsAsFailure(decided) ? decided : { kind: 'wait', reason: 'ATTEMPTS_EXHAUSTED' };
  }
  if (!windowOpen) return { kind: 'wait', reason: 'BEFORE_WINDOW' };
  if (run.nextAttemptAt !== null && now.getTime() < run.nextAttemptAt.getTime()) {
    return { kind: 'wait', reason: 'SPACING' };
  }
  return { kind: 'attempt', mode: run.progress.applying ? 'resume' : 'search' };
}

/**
 * BR-004-04: a list that the validator refused is not tried again. After a refusal the next
 * download is judged: the same file (same generation day, or both unreadable) changes nothing;
 * a different one is judged on its own.
 */
export function isSameRejectedFile(
  rejection: RunProgress['rejection'],
  generatedOn: string | null,
): boolean {
  return rejection !== null && rejection.generatedOn === generatedOn;
}
