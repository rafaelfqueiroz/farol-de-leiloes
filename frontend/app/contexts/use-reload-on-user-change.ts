'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

/**
 * Keeps a per-user resource (favourites, reminders) in step with who is signed in (#42).
 *
 * - On mount, `load` runs at once: with a stored token it fetches in parallel with
 *   `/api/auth/me` instead of waiting for it.
 * - Once auth has resolved, signing out — or a token that turned out invalid — calls `clear`, and a
 *   change of user (sign-in after the root layout mounted, another account) calls `clear` and
 *   then `load`, so the previous account's data never shows for the new one.
 *
 * `clear` marks an account change: the caller bumps its account generation there and drops any
 * load or mutation response started under an older generation. `load` and `clear` must be stable.
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
    if (userId === null) {
      clear();
    } else if (previous !== undefined) {
      // the first resolution to a user is the one the mount load already fetched for
      clear();
      load();
    }
  }, [userId, load, clear]);
}
