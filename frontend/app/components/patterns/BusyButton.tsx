'use client';

import Button, { type ButtonProps } from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { useLayoutEffect, useRef, useState } from 'react';

export interface BusyButtonProps extends Omit<ButtonProps, 'disabled'> {
  /** The action is running: spinner, `busyLabel`, no second click, same footprint. */
  busy?: boolean;
  /** What the button says while it runs, from the catalogue: "Abrindo pagamento…". */
  busyLabel: string;
  /** Not available at all (not the same as busy). */
  disabled?: boolean;
}

/**
 * DS-17 (SPEC-012 frame 17): the button of an action that takes a moment. While `busy` it is
 * `aria-busy` and `aria-disabled` rather than `disabled`, so focus stays on it and a screen reader
 * hears the new label; clicks are ignored; the spinner is decorative and the label carries the
 * state (DS-10, DS-21). It never gets narrower than it was (the width is measured as it goes
 * busy), so the layout does not jump.
 */
export default function BusyButton({
  busy = false,
  busyLabel,
  children,
  startIcon,
  onClick,
  sx,
  ...rest
}: BusyButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  // measured before paint, while the idle label is still on screen
  useLayoutEffect(() => {
    setWidth(busy ? (ref.current?.offsetWidth ?? null) : null);
  }, [busy]);

  return (
    <Button
      {...rest}
      ref={ref}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={busy ? undefined : onClick}
      startIcon={busy ? <CircularProgress size="1em" color="inherit" aria-hidden /> : startIcon}
      sx={[
        { minWidth: width ?? undefined, cursor: busy ? 'progress' : undefined },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {busy ? busyLabel : children}
    </Button>
  );
}
