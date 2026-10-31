import { TZDate } from '@date-fns/tz';
import { differenceInCalendarDays, format } from 'date-fns';
import { TIME_ZONE } from '@/i18n/config';

// AR-22: an instant is a UTC timestamp; a calendar date is a YYYY-MM-DD string that is never
// converted through a zone (midnight UTC would read as the previous evening in Brasília).
// AR-23: every zone conversion uses TIME_ZONE through @date-fns/tz, never a fixed offset.

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// an instant must say which zone it is in: "Z" or an offset
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export type ParsedDate =
  | { kind: 'calendar'; year: number; month: number; day: number }
  | { kind: 'instant'; date: Date };

export function parseDate(value: string): ParsedDate {
  const match = CALENDAR_DATE.exec(value);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    // reject 2026-02-31 instead of letting Date roll it over to March
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day
    ) {
      throw new RangeError(`Invalid calendar date: ${value}`);
    }
    return { kind: 'calendar', year, month, day };
  }
  if (!INSTANT.test(value)) {
    throw new RangeError(`Date must be YYYY-MM-DD or an ISO instant with a zone: ${value}`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid instant: ${value}`);
  }
  return { kind: 'instant', date };
}

/** `dd/MM/yyyy` (BR-003-20). A calendar date is formatted from its own parts, never shifted. */
export function formatDate(value: string): string {
  const parsed = parseDate(value);
  if (parsed.kind === 'calendar') {
    const { year, month, day } = parsed;
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${String(year).padStart(4, '0')}`;
  }
  return format(new TZDate(parsed.date, TIME_ZONE), 'dd/MM/yyyy');
}

/** `dd/MM/yyyy HH:mm` in Brasília time. A calendar date has no time, so it stays date-only. */
export function formatDateTime(value: string): string {
  const parsed = parseDate(value);
  if (parsed.kind === 'calendar') return formatDate(value);
  return format(new TZDate(parsed.date, TIME_ZONE), 'dd/MM/yyyy HH:mm');
}

/** Value for `<time dateTime>`: the calendar date as is, an instant normalised to UTC ISO. */
export function toDateTimeAttribute(value: string): string {
  const parsed = parseDate(value);
  return parsed.kind === 'calendar' ? value : parsed.date.toISOString();
}

export type RelativeUnit = 'now' | 'today' | 'minutes' | 'hours' | 'days';
export interface RelativeParts {
  unit: RelativeUnit;
  /** Always >= 0; `direction` carries the sign. */
  count: number;
  direction: 'future' | 'past';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Distance from `now` to `value` in the unit people say it in: minutes under an hour, hours
 * under a day, calendar days in Brasília after that. A calendar date is only ever compared in
 * whole days ("hoje", "em 14 dias").
 */
export function relativeParts(value: string, now: Date): RelativeParts {
  const parsed = parseDate(value);
  const nowInZone = new TZDate(now, TIME_ZONE);

  if (parsed.kind === 'calendar') {
    const target = new TZDate(parsed.year, parsed.month - 1, parsed.day, TIME_ZONE);
    const days = differenceInCalendarDays(target, nowInZone);
    return {
      unit: days === 0 ? 'today' : 'days',
      count: Math.abs(days),
      direction: days < 0 ? 'past' : 'future',
    };
  }

  const diff = parsed.date.getTime() - now.getTime();
  const direction = diff < 0 ? 'past' : 'future';
  const abs = Math.abs(diff);
  if (abs < MINUTE) return { unit: 'now', count: 0, direction };
  if (abs < HOUR) return { unit: 'minutes', count: Math.floor(abs / MINUTE), direction };
  if (abs < 24 * HOUR) return { unit: 'hours', count: Math.floor(abs / HOUR), direction };
  const days = differenceInCalendarDays(new TZDate(parsed.date, TIME_ZONE), nowInZone);
  return { unit: 'days', count: Math.abs(days), direction };
}
