// SPEC-010 BR-010-13: the return of a Google re-authentication arrives in the ADDRESS of the privacy
// page (`?reauth=<one-time code>` or `?reauthError=<CODE>`). The code is a credential (single use, 60
// seconds), so it is taken out of the address and the history entry the moment the app starts, by
// `ReauthReturnCapture` in the root layout, before any request and before any guard can navigate
// away, and kept here, in memory only: never in storage, a cookie, a log or a URL (SC-02, SC-15).
import { PRIVACY_PAGE_PATH } from '@/lib/legal';

export interface ReauthReturn {
  /** The one-time code, or null when Google refused. */
  code: string | null;
  /** Why there is no code (an error code of the API), when it came back refused. */
  error: string | null;
}

let captured: ReauthReturn | null = null;
const listeners = new Set<() => void>();

const publish = () => {
  for (const listener of [...listeners]) listener();
};

/**
 * Reads `reauth` / `reauthError` from the privacy page's address, replaces the history entry with
 * the plain path, and keeps what was read. Anywhere else, or without those parameters, it does
 * nothing. Returns whether something was captured.
 */
export function captureReauthReturn(
  location: Pick<Location, 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
): boolean {
  if (location.pathname !== PRIVACY_PAGE_PATH) return false;
  const params = new URLSearchParams(location.search);
  const code = params.get('reauth');
  const error = params.get('reauthError');
  if (code === null && error === null) return false;
  history.replaceState(null, '', location.pathname);
  captured = { code: code === '' ? null : code, error };
  publish();
  return true;
}

export function subscribeReauthReturn(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What was captured and not yet used, or null. The same object until it changes. */
export function currentReauthReturn(): ReauthReturn | null {
  return captured;
}

/** The code was used, or is no good any more: forget it. */
export function clearReauthReturn(): void {
  if (captured === null) return;
  captured = null;
  publish();
}
