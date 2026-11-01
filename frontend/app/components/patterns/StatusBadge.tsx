'use client';

import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';

export type Status = 'onTime' | 'late' | 'done' | 'cancelled' | 'neutral';

export interface StatusBadgeProps {
  status: Status;
}

// DS-10: the label always shows; the colour and the dot are never the only signal.
export default function StatusBadge({ status }: StatusBadgeProps) {
  const t = useTranslations('patterns.statusBadge');
  const hollow = status === 'cancelled';

  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.25,
        py: 0.25,
        borderRadius: `${theme.shape.pillRadius}px`,
        bgcolor: `status.${status}Surface`,
        color: `status.${status}`,
        ...theme.typography.caption,
        // the 600 weight the theme already uses for labels (typography.button)
        fontWeight: theme.typography.button.fontWeight,
        whiteSpace: 'nowrap',
      })}
    >
      <Box
        component="span"
        aria-hidden
        sx={(theme) => ({
          width: theme.spacing(0.75),
          height: theme.spacing(0.75),
          borderRadius: '50%',
          flexShrink: 0,
          boxSizing: 'border-box',
          // cancelled: hollow dot, a second cue besides the label
          ...(hollow
            ? {
                borderWidth: theme.spacing(0.25),
                borderStyle: 'solid',
                borderColor: 'currentColor',
              }
            : { bgcolor: 'currentColor' }),
        })}
      />
      {t(status)}
    </Box>
  );
}
