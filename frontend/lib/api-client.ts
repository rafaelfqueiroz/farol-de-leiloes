// Browser-side. The one way client code calls the same-origin BFF (`/api/*`).
//
// SC-02: the session lives in an httpOnly cookie the browser sends by itself. This module never
// sees, stores or sets a token and never builds an `Authorization` header: the BFF reads the
// cookie and talks to the backend.
//
// What it centralises: the JSON request body, the `ApiError` of a failed call (AR-37, AR-39: the
// caller turns it into text with `useApiErrorMessage`), and the one global reaction to a dead
// session (a 401 UNAUTHENTICATED), so no screen handles it on its own.
import { readApiError } from '@/lib/api-error';

export interface ApiRequestInit extends Omit<RequestInit, 'body' | 'headers' | 'credentials'> {
  /** The request body; sent as JSON with the matching `Content-Type`. */
  json?: unknown;
}

// BR-001-18, SC-02: the browser's session changes (sign-in, sign-out, a session that ended) while
// requests are still in flight, and an answer cannot tell which session its request was made
// under. The auth generation is that missing fact: a counter `AuthContext` bumps whenever the
// session changes. A request notes the generation when it starts; a 401 UNAUTHENTICATED that comes
// back after the generation moved belongs to an older session and is ignored.
let authGeneration = 0;

/** The number of session changes so far; compare it with the value captured at the start of a call. */
export function currentAuthGeneration(): number {
  return authGeneration;
}

/** Marks a session change: every call still in flight now belongs to an older generation. */
export function bumpAuthGeneration(): void {
  authGeneration += 1;
}

type SessionEndedListener = () => void;
const sessionEndedListeners = new Set<SessionEndedListener>();

/**
 * Subscribes to "the session ended": the BFF answered 401 UNAUTHENTICATED to a request made under
 * the current session (not a stale one, see the auth generation), so the session is gone, expired
 * or revoked. The BFF does not clear the cookie for it; the dead cookie is refused by the backend
 * and replaced by the next sign-in. `AuthContext` listens and signs the user out in the UI. Returns the
 * unsubscribe function.
 */
export function onSessionEnded(listener: SessionEndedListener): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

async function isUnauthenticated(response: Response): Promise<boolean> {
  try {
    const body: unknown = await response.clone().json();
    return (
      typeof body === 'object' && body !== null && Reflect.get(body, 'code') === 'UNAUTHENTICATED'
    );
  } catch {
    return false;
  }
}

/**
 * `fetch` against the BFF with the session cookie (`credentials: 'same-origin'`) and an optional
 * JSON body. Resolves with the raw `Response`, so a caller can branch on the status; a 401
 * UNAUTHENTICATED also tells the app the session ended, unless the session changed while the call
 * was in flight (a stale answer, BR-001-18). Rejects only on a network failure.
 */
export async function apiFetch(
  path: string,
  { json, ...init }: ApiRequestInit = {},
): Promise<Response> {
  const generation = currentAuthGeneration();
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    ...(json !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) }
      : {}),
  });
  if (
    response.status === 401 &&
    (await isUnauthenticated(response)) &&
    currentAuthGeneration() === generation
  ) {
    for (const listener of [...sessionEndedListeners]) listener();
  }
  return response;
}

/** Like `apiFetch`, but returns the parsed JSON body (`undefined` for a 204) and throws an `ApiError` for a non-2xx answer. */
export async function apiJson<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await readApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
