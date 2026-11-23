'use client';

import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import {
  formatDate,
  formatDateTime,
  parseDate,
  relativeParts,
  toDateTimeAttribute,
  type RelativeParts,
} from '@/lib/dates';

export interface DateTextProps {
  /** An ISO instant with a zone, or a YYYY-MM-DD calendar date (never shifted, AR-22). */
  value: string;
  withTime?: boolean;
  /**
   * Appends "(horário de Brasília)" after a time of day (BR-003-23); default true. Only a caller
   * that states the zone once for the whole column or section turns it off (the acceptances table:
   * its header says "(horário de Brasília)"), so no time on a page is left without its zone.
   */
  zoneMarker?: boolean;
  /** Appends "· em 14 dias" after the absolute date, which is always shown. */
  relative?: boolean;
  /** The clock for `relative`; injectable so tests do not depend on today. */
  now?: Date;
}

function RelativeText({ parts }: { parts: RelativeParts }) {
  const t = useTranslations('patterns.dateText.relative');
  const { unit, count, direction } = parts;
  const phrase =
    unit === 'now' || unit === 'today' ? t(unit) : t(`${unit}.${direction}`, { count });
  return (
    // the server clock and the browser clock can differ at a unit boundary
    <Typography
      component="span"
      variant="inherit"
      sx={{ color: 'text.secondary' }}
      suppressHydrationWarning
    >
      {t('joined', { relative: phrase })}
    </Typography>
  );
}

// DS-29, AR-23: the only place dates are rendered, in Brasília time, inside <time>. A time of day
// is followed by "(horário de Brasília)" (BR-003-23); a date alone needs no zone.
export default function DateText({
  value,
  withTime = false,
  zoneMarker = true,
  relative = false,
  now,
}: DateTextProps) {
  const t = useTranslations('patterns.dateText');
  let dateTime: string;
  let label: string;
  let showsTimeOfDay: boolean;
  try {
    dateTime = toDateTimeAttribute(value);
    label = withTime ? formatDateTime(value) : formatDate(value);
    // a calendar date has no time of day, so there is no clock to name (AR-22)
    showsTimeOfDay = withTime && parseDate(value).kind === 'instant';
  } catch (error: unknown) {
    // AR-22, DS-29: one malformed legacy timestamp must not take down a whole list.
    if (!(error instanceof RangeError)) throw error;
    return (
      <Typography component="span" variant="inherit">
        {t('invalid')}
      </Typography>
    );
  }

  return (
    <Typography component="span" variant="inherit" sx={{ fontVariantNumeric: 'tabular-nums' }}>
      <time dateTime={dateTime}>{label}</time>
      {showsTimeOfDay && zoneMarker ? t('timeZoneMarker') : null}
      {relative ? <RelativeText parts={relativeParts(value, now ?? new Date())} /> : null}
    </Typography>
  );
}
