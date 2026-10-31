'use client';

import ArrowDownwardOutlined from '@mui/icons-material/ArrowDownwardOutlined';
import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';

export interface FigureDeltaProps {
  /** Already formatted, e.g. "12,5%" or a Money element's text. */
  value: string;
  /** Whether the change is good (`positive`) or bad (`negative`) for the user. */
  tone: 'positive' | 'negative';
  /** The way the figure moved. A discount points down and is positive. */
  direction: 'up' | 'down';
}

// DS-10: direction is the arrow and its accessible name; colour only reinforces the tone.
// DS-24: never brand-coloured.
export default function FigureDelta({ value, tone, direction }: FigureDeltaProps) {
  const t = useTranslations('patterns.figureDelta');
  const Icon = direction === 'up' ? ArrowUpwardOutlined : ArrowDownwardOutlined;
  const label = t(`${direction}${tone === 'positive' ? 'Positive' : 'Negative'}`);

  return (
    <Typography
      component="span"
      variant="body2"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        color: `figure.${tone}`,
        fontWeight: (theme) => theme.typography.button.fontWeight,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <Icon fontSize="small" titleAccess={label} />
      {value}
    </Typography>
  );
}
