// SPEC-004 BR-004-31: what a business day is. Pure (AR-05): the Brasília calendar day arrives as a
// `YYYY-MM-DD` string (AR-22) and the holiday calendar as an argument; nothing here reads a clock,
// the environment or the network. `BusinessCalendar` (common/services) supplies both.

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const SUNDAY = 0;
const SATURDAY = 6;

/** A calendar day as its parts; `month` is 1-12, as written in the date. */
export interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

/** The parts of a real `YYYY-MM-DD` day, or null for anything else ("2026-02-30", "2026-2-3"). */
export function parseCalendarDate(value: string): CalendarDateParts | null {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls an impossible day over (30 February is 2 March) and reads years 0-99 as 19xx;
  // the round trip catches both.
  const real =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

export function isCalendarDate(value: string): boolean {
  return parseCalendarDate(value) !== null;
}

/**
 * The calendar day `days` after (or, negative, before) `brasiliaDate`, as `YYYY-MM-DD`. Counted on
 * the calendar, so month and year ends roll over and no zone or daylight rule enters.
 */
export function addCalendarDays(brasiliaDate: string, days: number): string {
  const { year, month, day } = partsOf(brasiliaDate);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function partsOf(brasiliaDate: string): CalendarDateParts {
  const parts = parseCalendarDate(brasiliaDate);
  if (!parts) throw new RangeError('A calendar day must be a real YYYY-MM-DD date');
  return parts;
}

/** Saturday or Sunday. The week is the same on every Brasília day: the zone does not enter. */
export function isWeekend(brasiliaDate: string): boolean {
  const { year, month, day } = partsOf(brasiliaDate);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === SATURDAY || weekday === SUNDAY;
}

/**
 * BR-004-31: a Brasília calendar day that is not a Saturday, not a Sunday and not in the
 * national-holiday calendar. A holiday on a weekend changes nothing.
 *
 *   isBusinessDay('2026-12-25', new Set(['2026-12-25'])) // false: a Friday, but Christmas
 *   isBusinessDay('2026-11-23', new Set())                // true: a Monday
 */
export function isBusinessDay(brasiliaDate: string, holidays: ReadonlySet<string>): boolean {
  return !isWeekend(brasiliaDate) && !holidays.has(brasiliaDate);
}

/** Whether the calendar has at least one entry in `year` (BR-004-31: otherwise it is not set up). */
export function hasHolidaysInYear(year: number, holidays: ReadonlySet<string>): boolean {
  const prefix = `${String(year).padStart(4, '0')}-`;
  for (const holiday of holidays) {
    if (holiday.startsWith(prefix)) return true;
  }
  return false;
}

/** The year of a real `YYYY-MM-DD` day. */
export function yearOf(brasiliaDate: string): number {
  return partsOf(brasiliaDate).year;
}
