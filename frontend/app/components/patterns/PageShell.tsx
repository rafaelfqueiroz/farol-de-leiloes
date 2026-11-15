'use client';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import type { ReactNode } from 'react';

export interface PageShellProps {
  /**
   * `app` (1200) for lists, dashboards, plans and details; `reading` (720) for forms, settings,
   * text; `narrow` (480) for short forms and result screens outside the shell.
   */
  width?: 'app' | 'reading' | 'narrow';
  /** `main` for pages outside the shell, which have no landmark of their own (DS-21). */
  component?: 'div' | 'main';
  children: ReactNode;
}

// DS-14: the only place a page's width, gutters and vertical rhythm are set. This renders a
// plain container: inside the shell the layout owns the single <main> landmark, so nesting one
// here would duplicate it; only the pages outside the shell ask for `component="main"`.
export default function PageShell({ width = 'app', component = 'div', children }: PageShellProps) {
  return (
    <Box
      component={component}
      sx={{
        width: '100%',
        // DS-04: the widths come from the theme (theme.layout), not from tokens.ts
        maxWidth: (theme) =>
          ({
            app: theme.layout.containerWidth,
            reading: theme.layout.readingWidth,
            narrow: theme.layout.narrowWidth,
          })[width],
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
