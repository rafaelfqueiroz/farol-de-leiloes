'use client';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /** Rendered as the page's only <h1> (DS-15). */
  title: string;
  summary?: ReactNode;
  /** Slot for the Breadcrumbs primitive, shown on pages two or more levels deep. */
  breadcrumbs?: ReactNode;
  /** Right of the title from md; below it on phone. */
  actions?: ReactNode;
}

export default function PageHeader({ title, summary, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <Stack spacing={1}>
      {breadcrumbs}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { xs: 'stretch', md: 'flex-start' } }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h1" component="h1" sx={{ textWrap: 'balance' }}>
            {title}
          </Typography>
          {summary ? (
            <Typography variant="body1" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {summary}
            </Typography>
          ) : null}
        </Box>
        {actions ? (
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap', flexShrink: 0, alignItems: 'center' }}
          >
            {actions}
          </Stack>
        ) : null}
      </Stack>
    </Stack>
  );
}
