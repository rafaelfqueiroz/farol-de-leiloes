// SPEC-010 BR-010-18, BR-010-19, BR-010-24: the retention clock of closed journeys' documents. Pure
// (AR-05): the date of "today" comes in as an argument (AR-24) and nothing here touches a framework
// or the environment. A critical module, held at 100% branch coverage (TS-24).
//
// Calendar dates are `YYYY-MM-DD` strings (AR-22): the Brasília calendar day a journey closed on
// (SPEC-003 BR-003-26), never an instant. The clock is the Nth ANNIVERSARY of that date, clamped to
// the last day of the month when the target year has no such day: a journey closed on 29 February
// 2028 is kept through 28 February 2033 (BR-010-19). This is NOT `addYearsAnniversary` of
// common/clock/brasilia-time.ts, which moves 29 February to 1 March for deadlines that fall due on
// the anniversary; here the document is kept THROUGH the anniversary and deleted from the day after.

/** A malformed or impossible calendar date, or a retention period that is not a positive whole number. */
export class InvalidRetentionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRetentionInputError';
  }
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number =>
  month === 2 ? (isLeapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;

/** Reads `YYYY-MM-DD`; refuses a malformed string and a day that does not exist (31 April, 29/02/2027). */
function parseCalendarDate(value: string): CalendarDate {
  const match = CALENDAR_DATE.exec(value);
  if (match === null) throw new InvalidRetentionInputError('not a YYYY-MM-DD calendar date');
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new InvalidRetentionInputError('not a day of the calendar');
  }
  return { year, month, day };
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/**
 * The same day `years` calendar years later (earlier when negative), or the last day of that month
 * when the target year has no such day (29 February -> 28 February in a common year). The year stays
 * within 0001-9999 so the result compares correctly as text.
 */
function shiftYears(date: string, years: number): string {
  const { year, month, day } = parseCalendarDate(date);
  const target = year + years;
  if (target < 1 || target > 9999) {
    throw new InvalidRetentionInputError('the year is out of range');
  }
  return `${pad(target, 4)}-${pad(month, 2)}-${pad(Math.min(day, daysInMonth(target, month)), 2)}`;
}

function assertYears(years: number): void {
  if (!Number.isInteger(years) || years < 1) {
    throw new InvalidRetentionInputError(
      'the retention period is a whole number of years, at least 1',
    );
  }
}

/**
 * BR-010-19: the last day the documents of a journey closed on `closedOn` are kept: its Nth
 * anniversary, clamped to the month's last day. 15/03/2027 + 5 -> 15/03/2032; 29/02/2028 + 5 ->
 * 28/02/2033; 29/02/2028 + 4 -> 29/02/2032 (a leap year again).
 */
export function lastDayKept(closedOn: string, years: number): string {
  assertYears(years);
  return shiftYears(closedOn, years);
}

/**
 * BR-010-19, BR-010-21: whether the documents go today. They are kept THROUGH `lastDayKept` and
 * deleted from the following day on: today must be strictly after it. The kind of closing (won, lost,
 * cancelled) never enters the rule (DL-010-05, D-41).
 */
export function isDueForPurge(todayBrasilia: string, closedOn: string, years: number): boolean {
  parseCalendarDate(todayBrasilia);
  return todayBrasilia > lastDayKept(closedOn, years);
}

/**
 * The latest closing date a journey due for purge today can have: today minus `years` years (clamped).
 * A source filters by it, and the caller re-checks each result with `isDueForPurge`; it is never the
 * rule itself. Every journey that is due has a closing date at or before this one (a property the
 * spec checks across years, month ends and leap days).
 */
export function closedOnCutoff(todayBrasilia: string, years: number): string {
  assertYears(years);
  return shiftYears(todayBrasilia, -years);
}

/** How a journey ended (SPEC-003): the kind never changes the rule (D-41), but it must be one of these. */
export const CLOSED_KINDS = ['won', 'lost', 'cancelled'] as const;
export type ClosedKind = (typeof CLOSED_KINDS)[number];

/**
 * The earliest closing date a source can plausibly report: the product did not exist before it. A
 * date before it (0000-01-01, 1970-01-01, an epoch-zero default) is a defect in the source, never a
 * journey whose documents are old enough to delete.
 */
export const EARLIEST_CLOSED_ON = '2020-01-01';

/** Why a candidate the source listed is outside the contract; null when it is within. */
export type ClosingProblem = 'unknown-kind' | 'before-floor' | 'in-the-future' | null;

/**
 * BR-010-19: a journey that is not closed is on no clock, and the source is trusted to list closed
 * journeys only. This ENFORCES it from what the candidate itself says: a closing kind other than
 * won / lost / cancelled, a closing date before EARLIEST_CLOSED_ON or one after today (Brasília) is
 * not a closed journey whose period can be read, so it is never purged. A malformed date throws
 * (`InvalidRetentionInputError`).
 */
export function closingProblem(
  closedOn: string,
  closedKind: string,
  todayBrasilia: string,
): ClosingProblem {
  parseCalendarDate(closedOn);
  parseCalendarDate(todayBrasilia);
  if (!(CLOSED_KINDS as readonly string[]).includes(closedKind)) return 'unknown-kind';
  if (closedOn < EARLIEST_CLOSED_ON) return 'before-floor';
  if (closedOn > todayBrasilia) return 'in-the-future';
  return null;
}

/** Journeys one run deletes at most while the period is not backed by the lawyer's validation. */
export const UNVALIDATED_RUN_CAP = 25;

/**
 * What the lawyer reviewed against what is set now, for the safety brake of the daily deletion:
 *
 * - `validated`: the newest retention validation covers the setting (it noted no period, or a period
 *   not longer than the setting), so documents deleted by the setting are not kept longer by the
 *   lawyer's opinion. Raising the period never needs the brake.
 * - `lowered`: the setting is SHORTER than the period the lawyer reviewed. Lowering deletes
 *   irreversibly at the next run, so the run is capped (UNVALIDATED_RUN_CAP) and warns.
 * - `provisional`: no validation is recorded (BR-010-24); the run is capped too.
 *
 * `reviewedYears` is undefined when no validation exists, null when the newest one noted no period.
 */
export type RetentionReview = 'validated' | 'lowered' | 'provisional';

export function retentionReview(
  settingYears: number,
  reviewedYears: number | null | undefined,
): RetentionReview {
  if (reviewedYears === undefined) return 'provisional';
  if (reviewedYears !== null && reviewedYears > settingYears) return 'lowered';
  return 'validated';
}
