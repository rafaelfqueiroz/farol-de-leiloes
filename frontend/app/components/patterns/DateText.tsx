'use client';

import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import {
  formatDate,
  formatDateTime,
  relativeParts,
  toDateTimeAttribute,
  type RelativeParts,
} from '@/lib/dates';

export interface DateTextProps {
  /** An ISO instant with a zone, or a YYYY-MM-DD calendar date (never shifted, AR-22). */
  value: string;
  withTime?: boolean;
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
    <Typography component="span" variant="inherit" sx={{ color: 'text.secondary' }} suppressHydrationWarning>
      {t('joined', { relative: phrase })}
    </Typography>
  );
}

// DS-29, AR-23: the only place dates are rendered, in Brasília time, inside <time>.
export default function DateText({ value, withTime = false, relative = false, now }: DateTextProps) {
  return (
    <Typography component="span" variant="inherit" sx={{ fontVariantNumeric: 'tabular-nums' }}>
      <time dateTime={toDateTimeAttribute(value)}>
        {withTime ? formatDateTime(value) : formatDate(value)}
      </time>
      {relative ? <RelativeText parts={relativeParts(value, now ?? new Date())} /> : null}
    </Typography>
  );
}
