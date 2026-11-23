'use client';

import { useEffect } from 'react';
import { captureReauthReturn } from '@/lib/reauth-return';

/**
 * Mounted first in the root layout, so its effect runs before the providers' and any guard's: the
 * one-time code of a Google re-authentication leaves the address bar and the history entry at once
 * (SPEC-010 BR-010-13), whether the privacy page then loads, fails to load or the session is gone.
 * Renders nothing.
 */
export default function ReauthReturnCapture() {
  useEffect(() => {
    captureReauthReturn(window.location, window.history);
  }, []);
  return null;
}
