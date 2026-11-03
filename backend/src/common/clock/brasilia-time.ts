// AR-23: the backend's one owner of the product's time zone. Every date the product shows,
// accepts or schedules is in Brasília time (SPEC-003 BR-003-23..BR-003-28), converted with
// @date-fns/tz and the IANA zone — never a fixed -03:00 offset (BR-003-28). Instants stay UTC
// `Date`s (AR-22); this module only answers questions about Brasília's calendar and wall clock.
import { TZDate, tz } from '@date-fns/tz';
import { isSameDay, startOfDay } from 'date-fns';

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

/** Whether two instants fall on the same calendar day in Brasília. */
export function isSameBrasiliaDay(left: Date, right: Date): boolean {
  return isSameDay(left, right, { in: inBrasilia });
}
