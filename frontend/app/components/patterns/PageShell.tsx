'use client';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import type { ReactNode } from 'react';
import { size } from '@/app/theme/tokens';

export interface PageShellProps {
  /** `app` (1200) for lists, dashboards and details; `reading` (720) for forms, settings, text. */
  width?: 'app' | 'reading';
  children: ReactNode;
}

const maxWidth = { app: size.container, reading: size.reading } as const;

// DS-14: the only place a page's width, gutters and vertical rhythm are set. This renders a
// plain container: the shell/layout (or the legacy page) owns the single <main> landmark, so
// nesting one here would duplicate it.
export default function PageShell({ width = 'app', children }: PageShellProps) {
  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: maxWidth[width],
        mx: 'auto',
        px: { xs: 2, sm: 3 },
        pt: 3,
        pb: 4,
      }}
    >
      {/* sections are space-4 apart */}
      <Stack spacing={4}>{children}</Stack>
    </Box>
  );
}
