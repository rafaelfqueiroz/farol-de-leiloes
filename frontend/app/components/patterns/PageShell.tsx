'use client';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import type { ReactNode } from 'react';

export interface PageShellProps {
  /** `app` (1200) for lists, dashboards and details; `reading` (720) for forms, settings, text. */
  width?: 'app' | 'reading';
  children: ReactNode;
}

// DS-14: the only place a page's width, gutters and vertical rhythm are set. This renders a
// plain container: the shell/layout (or the legacy page) owns the single <main> landmark, so
// nesting one here would duplicate it.
export default function PageShell({ width = 'app', children }: PageShellProps) {
  return (
    <Box
      sx={{
        width: '100%',
        // DS-04: the widths come from the theme (theme.layout), not from tokens.ts
        maxWidth: (theme) =>
          width === 'reading' ? theme.layout.readingWidth : theme.layout.containerWidth,
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
