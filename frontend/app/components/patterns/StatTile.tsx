'use client';

import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

export interface StatTileProps {
  label: string;
  /** The headline figure, already rendered (a Money element or a formatted count). */
  value: ReactNode;
  /** One line of context: caption text, a FigureDelta or a StatusBadge. */
  context?: ReactNode;
}

// The value is text.primary, never brand or status coloured; meaning lives in `context`.
export default function StatTile({ label, value, context }: StatTileProps) {
  return (
    <Card sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography variant="overline" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="metric" component="p" sx={{ color: 'text.primary' }}>
        {value}
      </Typography>
      {context ? (
        <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
          {context}
        </Typography>
      ) : null}
    </Card>
  );
}
