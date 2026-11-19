'use client';

import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import InlineAlert from './InlineAlert';

export interface ShellBannerProps {
  /** `warning` for something to do, `info` once it is done, `error` when it failed. */
  severity: 'warning' | 'info' | 'error';
  /** A short statement above the message (the billing variant: "Plano encerrado em 12/11/2026"). */
  title?: ReactNode;
  /** The message. */
  children?: ReactNode;
  /** The one action, usually a `Button`; the banner has no close button (DESIGN.md §6). */
  action?: ReactNode;
  /** `alert` for the billing notices that must be heard once on load; default `status`. */
  role?: 'status' | 'alert';
}

/**
 * DS-17 (frame 5): the banner the `AppShell` draws between the top bar and the content. It is the
 * `InlineAlert`, announced politely (`role="status"`, so it is not read as an alert on every
 * navigation), full width of the content area with the page gutters (16 px on phone, 24 px from
 * `sm`) and 16 px above. It knows nothing about what it says (DS-03): the domain wiring lives in
 * the feature that fills the shell's `banner` slot. The billing variant (SPEC-012 frame 18) adds a
 * `title` and may announce as an `alert`.
 */
export default function ShellBanner({
  severity,
  title,
  children,
  action,
  role = 'status',
}: ShellBannerProps) {
  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2 }}>
      <InlineAlert severity={severity} title={title} action={action} role={role}>
        {children}
      </InlineAlert>
    </Box>
  );
}
