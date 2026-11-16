// AR-23: the backend's one owner of the product's time zone. Every date the product shows,
// accepts or schedules is in Brasília time (SPEC-003 BR-003-23..BR-003-28), converted with
// @date-fns/tz and the IANA zone — never a fixed -03:00 offset (BR-003-28). Instants stay UTC
// `Date`s (AR-22); this module only answers questions about Brasília's calendar and wall clock.
import { TZDate, tz } from '@date-fns/tz';
import { endOfDay, format, isLeapYear, isSameDay, startOfDay } from 'date-fns';

/** AR-23 / AR-25: the IANA zone of every date in the product, and of every @Cron. */
export const BRASILIA_TIME_ZONE = 'America/Sao_Paulo';

/** date-fns context option: `isSameDay(a, b, { in: inBrasilia })` reads both in Brasília. */
export const inBrasilia = tz(BRASILIA_TIME_ZONE);

/** The wall-clock fields of a time in Brasília; `month` is 1–12, as written in a date. */
export interface BrasiliaWallClock {
  year: number;
  month: number;
  day: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

/**
 * The instant a Brasília wall clock shows — the server's own zone plays no part. Caixa writes
 * "26/01/2026 - 10h00" meaning Brasília: that is 13:00 UTC, on a server in UTC or anywhere else.
 */
export function brasiliaWallClockToInstant({
  year,
  month,
  day,
  hours = 0,
  minutes = 0,
  seconds = 0,
}: BrasiliaWallClock): Date {
  const local = new TZDate(year, month - 1, day, hours, minutes, seconds, BRASILIA_TIME_ZONE);
  return new Date(local.getTime());
}

/** Midnight in Brasília of the Brasília day `instant` falls on, as a UTC instant. */
export function startOfBrasiliaDay(instant: Date): Date {
  return new Date(startOfDay(instant, { in: inBrasilia }).getTime());
}

/** 23:59:59.999 in Brasília of the Brasília day `instant` falls on, as a UTC instant. */
export function endOfBrasiliaDay(instant: Date): Date {
  return new Date(endOfDay(instant, { in: inBrasilia }).getTime());
}

/** Whether two instants fall on the same calendar day in Brasília. */
export function isSameBrasiliaDay(left: Date, right: Date): boolean {
  return isSameDay(left, right, { in: inBrasilia });
}

/**
 * The same Brasília day-and-time `years` calendar years later (BR-003-26, anniversary-based
 * deadlines). 29 February has no anniversary in a common year: it falls on 1 March, never on a
 * day that rolls over by accident. The wall-clock time is kept, so the UTC instant follows the
 * zone rules of the target date (BR-003-28), not a fixed offset.
 */
export function addYearsAnniversary(instant: Date, years: number): Date {
  const local = new TZDate(instant, BRASILIA_TIME_ZONE);
  const year = local.getFullYear() + years;
  const leapDay = local.getMonth() === 1 && local.getDate() === 29;
  const [month, day] =
    leapDay && !isLeapYear(new TZDate(year, 0, 1, BRASILIA_TIME_ZONE))
      ? [2, 1]
      : [local.getMonth(), local.getDate()];
  const anniversary = new TZDate(
    year,
    month,
    day,
    local.getHours(),
    local.getMinutes(),
    local.getSeconds(),
    local.getMilliseconds(),
    BRASILIA_TIME_ZONE,
  );
  return new Date(anniversary.getTime());
}

/** A Brasília calendar month as instants: `start` inclusive, `end` (the next month's start) exclusive. */
export interface BrasiliaMonthBounds {
  start: Date;
  end: Date;
}

/**
 * Midnight of the first day of the Brasília month `instant` falls on, and of the first day of
 * the next one (BR-003-26, month boundaries for availability). 01/02/2026 02:59 UTC is still
 * January in Brasília. A month's length in hours follows the zone rules (BR-003-28).
 */
export function brasiliaMonthBounds(instant: Date): BrasiliaMonthBounds {
  const local = new TZDate(instant, BRASILIA_TIME_ZONE);
  const start = new TZDate(local.getFullYear(), local.getMonth(), 1, BRASILIA_TIME_ZONE);
  const end = new TZDate(local.getFullYear(), local.getMonth() + 1, 1, BRASILIA_TIME_ZONE);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

/** AR-23 marker: where a time of day is shown it says which clock it is (BR-003-23). */
export const BRASILIA_TIME_MARKER = '(horário de Brasília)';

/** `dd/mm/aaaa HH:mm` in Brasília time, whatever the server's zone (BR-003-20, BR-003-23). */
export function formatBrasiliaDateTime(instant: Date): string {
  return format(instant, 'dd/MM/yyyy HH:mm', { in: inBrasilia });
}

/** `dd/mm/aaaa HH:mm (horário de Brasília)`: the form emails and other texts show (BR-003-22/23). */
export function formatBrasiliaDateTimeMarked(instant: Date): string {
  return `${formatBrasiliaDateTime(instant)} ${BRASILIA_TIME_MARKER}`;
}
