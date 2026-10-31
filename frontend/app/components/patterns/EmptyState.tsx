'use client';

import type { SvgIconComponent } from '@mui/icons-material';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** An Outlined icon from @mui/icons-material (DS-25). */
  icon: SvgIconComponent;
  title: string;
  description: string;
  /** One or two actions: the next step (DS-19). */
  actions?: ReactNode;
  /** Heading level of the title; follows the page outline, never its size (DS-15). */
  titleComponent?: 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  titleComponent = 'h2',
}: EmptyStateProps) {
  return (
    <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', px: 2, py: 6 }}>
      <Box
        sx={(theme) => ({
          width: theme.spacing(7),
          height: theme.spacing(7),
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'primary.soft',
          color: 'primary.main',
        })}
      >
        <Icon aria-hidden fontSize="medium" />
      </Box>
      <Stack spacing={0.5} sx={{ maxWidth: '36em' }}>
        <Typography variant="h4" component={titleComponent}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {description}
        </Typography>
      </Stack>
      {actions ? (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          {actions}
        </Stack>
      ) : null}
    </Stack>
  );
}
