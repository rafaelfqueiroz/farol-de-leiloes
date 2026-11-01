'use client';

import Typography, { type TypographyProps } from '@mui/material/Typography';
import type Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';
import { formatMoney, formatMoneyCompact } from '@/lib/money';

export interface MoneyProps {
  /** A decimal string from the API or a Decimal. Never a JS number (AR-17). */
  value: string | Decimal | null;
  variant?: TypographyProps['variant'];
  /** `R$ 2,4 mi` / `R$ 380 mil`; the full value stays in the accessible name. */
  compact?: boolean;
}

// DS-29, AR-21: the only place BRL amounts are rendered.
export default function Money({ value, variant = 'inherit', compact = false }: MoneyProps) {
  const t = useTranslations('patterns.money');

  // BR-003-19: a missing amount is "Não informado", never R$ 0,00
  if (value === null) {
    return (
      <Typography component="span" variant={variant} sx={{ color: 'text.secondary' }}>
        {t('missing')}
      </Typography>
    );
  }

  // DS-12: columns of amounts line up
  const sx = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;

  if (compact) {
    return (
      <Typography
        component="span"
        variant={variant}
        role="img"
        aria-label={formatMoney(value)}
        sx={sx}
      >
        {formatMoneyCompact(value)}
      </Typography>
    );
  }

  return (
    <Typography component="span" variant={variant} sx={sx}>
      {formatMoney(value)}
    </Typography>
  );
}
