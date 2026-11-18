'use client';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import type { AlertColor } from '@mui/material/Alert';
import type { ReactNode } from 'react';

export interface InlineAlertProps {
  severity: AlertColor;
  /** A short statement of what happened, above the text: "Cancelamento agendado". */
  title?: ReactNode;
  /** The message; what to do about it. */
  children?: ReactNode;
  /** The one action, usually a `Button`; on a phone it moves under the text (DS-13, DS-16). */
  action?: ReactNode;
  /** An Outlined icon element that replaces the severity's own (DS-25); decorative. */
  icon?: ReactNode;
  /**
   * How it is announced. `alert` for something that appears after an action or that needs
   * attention at once (a failed charge), `status` for a calm notice; omitted, it is a `note`, not
   * a live region (it was on the page when it loaded, and MUI's own default would announce it).
   */
  role?: 'alert' | 'status' | 'note';
}

/**
 * DS-17 (SPEC-012 frames): the `Alert` with a title and an action slot. MUI's own action sits at
 * the end of the first line and squeezes the text on a phone; here the action wraps under the
 * message below `sm` and stays at the end from there, so a 44 px button never crushes a sentence.
 */
export default function InlineAlert({
  severity,
  title,
  children,
  action,
  icon,
  role = 'note',
}: InlineAlertProps) {
  return (
    <Alert
      severity={severity}
      role={role}
      {...(icon === undefined ? {} : { icon })}
      sx={{ alignItems: 'center', '& .MuiAlert-message': { flex: 1, minWidth: 0 } }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { xs: 'stretch', sm: 'center' },
          justifyContent: 'space-between',
          gap: { xs: 1.5, sm: 2 },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          {title ? <AlertTitle sx={{ mb: children ? 0.5 : 0 }}>{title}</AlertTitle> : null}
          {children}
        </Box>
        {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
      </Box>
    </Alert>
  );
}
