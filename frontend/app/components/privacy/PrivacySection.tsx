'use client';

import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId, type ReactNode } from 'react';

export interface PrivacySectionProps {
  title: string;
  description?: ReactNode;
  /** The delete-account zone: a destructive border, last on the page (DS-06). */
  danger?: boolean;
  children: ReactNode;
}

// SPEC-010 frame "Privacidade e dados": one flat card per right, its h2, a line under it and the
// content. The page's sections are in the order of the frame, the danger zone last.
export default function PrivacySection({
  title,
  description,
  danger = false,
  children,
}: PrivacySectionProps) {
  const headingId = useId();
  return (
    <Card
      component="section"
      aria-labelledby={headingId}
      sx={{
        p: { xs: 2, sm: 3 },
        ...(danger ? { borderColor: 'destructive.main' } : {}),
      }}
    >
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography id={headingId} variant="h3" component="h2">
            {title}
          </Typography>
          {description ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {description}
            </Typography>
          ) : null}
        </Stack>
        {children}
      </Stack>
    </Card>
  );
}
