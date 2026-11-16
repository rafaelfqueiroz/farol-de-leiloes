'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import type { ReactNode } from 'react';

export interface ShellBannerProps {
  /** `warning` for something to do, `info` once it is done, `error` when it failed. */
  severity: 'warning' | 'info' | 'error';
  /** The message. */
  children: ReactNode;
  /** The one action, usually a `Button`; the banner has no close button (DESIGN.md §6). */
  action?: ReactNode;
}

/**
 * DS-17 (frame 5): the banner the `AppShell` draws between the top bar and the content. It is the
 * existing `Alert`, announced politely (`role="status"`, so it is not read as an alert on every
 * navigation), full width of the content area with the page gutters (16 px on phone, 24 px from
 * `sm`) and 16 px above. It knows nothing about what it says (DS-03): the domain wiring lives in
 * the feature that fills the shell's `banner` slot.
 */
export default function ShellBanner({ severity, children, action }: ShellBannerProps) {
  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2 }}>
      <Alert severity={severity} role="status" action={action} sx={{ alignItems: 'center' }}>
        {children}
      </Alert>
    </Box>
  );
}
