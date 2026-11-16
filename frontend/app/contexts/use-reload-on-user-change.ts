'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

/**
 * Keeps a per-user resource (favourites, reminders) in step with who is signed in (#42).
 *
 * SC-02: the session is a cookie the browser's JavaScript cannot read, so nothing can be fetched
 * "in parallel with `/api/auth/me`": the resource loads once auth has resolved to a user.
 * - Auth resolving to nobody, signing out, or a session that ended calls `clear`.
 * - Auth resolving to a user calls `load`; a change of user (sign-in after the root layout mounted,
 *   another account) calls `clear` and then `load`, so the previous account's data never shows for
 *   the new one.
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
    if (userId === undefined) return;
    const previous = lastUserId.current;
    lastUserId.current = userId;
    if (previous === userId) return;
    if (userId === null) {
      clear();
      return;
    }
    // a change from one account to another (or from nobody) must not show the old data meanwhile
    if (previous !== undefined) clear();
    load();
  }, [userId, load, clear]);
}
