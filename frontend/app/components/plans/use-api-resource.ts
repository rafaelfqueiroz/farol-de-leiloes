'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from '@/lib/api-client';

export type Resource<T> =
  /** Nothing to read yet (the path is not known, or auth is still loading). */
  | { name: 'idle' }
  | { name: 'loading' }
  | { name: 'ready'; data: T }
  | { name: 'error'; error: unknown };

/**
 * Reads one BFF path (`apiJson`): `idle` while `path` is null, `loading`, then `ready` or `error`
 * (the `ApiError` is kept for `useApiErrorMessage`). `reload` reads again; a slower, older answer
 * never replaces a newer one. `quiet` reloads without going back to `loading`, so a page that is
 * waiting for the provider (an upgrade, a confirmation) does not flash its skeleton on every read.
 */
export function useApiResource<T>(path: string | null): {
  state: Resource<T>;
  reload: (options?: { quiet?: boolean }) => void;
} {
  const [state, setState] = useState<Resource<T>>(
    path === null ? { name: 'idle' } : { name: 'loading' },
  );
  const reads = useRef(0);

  const load = useCallback(
    (quiet: boolean) => {
      const read = ++reads.current;
      if (path === null) {
        setState({ name: 'idle' });
        return;
      }
      if (!quiet) setState({ name: 'loading' });
      apiJson<T>(path).then(
        (data) => {
          if (reads.current === read) setState({ name: 'ready', data });
        },
        (error: unknown) => {
          if (reads.current === read) setState({ name: 'error', error });
        },
      );
    },
    [path],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a BFF path starts in an effect
    load(false);
    return () => {
      // an answer to a path that is no longer wanted is dropped
      reads.current += 1;
    };
  }, [load]);

  const reload = useCallback(
    (options?: { quiet?: boolean }) => load(options?.quiet === true),
    [load],
  );
  return { state, reload };
}
