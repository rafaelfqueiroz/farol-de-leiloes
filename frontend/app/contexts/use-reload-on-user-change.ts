'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

/**
 * Keeps a per-user resource (favourites, reminders) in step with who is signed in (#42).
 *
 * - On mount, `load` runs at once: with a stored token it fetches in parallel with
 *   `/api/auth/me` instead of waiting for it.
 * - Once auth has resolved, a change of user loads again (sign-in after the root layout mounted,
 *   another account) and signing out — or a token that turned out invalid — calls `clear`.
 *
 * `load` and `clear` must be stable, and the caller guards its own requests so a response that
 * arrives after a newer load or a clear is dropped.
 */
export function useReloadOnUserChange(load: () => void, clear: () => void) {
  const { user, loading } = useAuth();
  // undefined while auth resolves; null when nobody is signed in
  const userId = loading ? undefined : (user?._id ?? null);
  const lastUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (userId === undefined) return;
    const previous = lastUserId.current;
    lastUserId.current = userId;
    if (previous === userId) return;
    if (userId === null) clear();
    // the first resolution to a user is the one the mount load already fetched for
    else if (previous !== undefined) load();
  }, [userId, load, clear]);
}
