// SPEC-004 BR-004-02: the list's "Data de geração". Caixa writes a calendar day, `10/11/2025`, with
// no time and no zone, so it is kept as one: a Brasília calendar day as `YYYY-MM-DD` (AR-22), never
// as an instant. Two such strings compare as the days they are.
import { parseCalendarDate } from '../../common/domain/business-day.js';

const GENERATION_DATE = /^(\d{2})\/(\d{2})\/(\d{4})(?:\D.*)?$/;

/**
 * `10/11/2025` -> `2025-11-10`. A time after the day ("10/11/2025 07:30") is ignored, since only the
 * day counts for "newer list". Anything else, or a day that does not exist (31/02/2025), is null.
 */
export function parseGenerationDate(cell: string): string | null {
  const match = GENERATION_DATE.exec(cell.trim());
  if (!match) return null;
  const [day, month, year] = [match[1], match[2], match[3]] as [string, string, string];
  const iso = `${year}-${month}-${day}`;
  return parseCalendarDate(iso) === null ? null : iso;
}
