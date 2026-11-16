// Server-side only (it reads serverEnv(), which throws in the browser).
//
// The Next.js route handlers under app/api are a thin BFF over the backend. This module is the one
// place they reach it from: it builds the URL (AR-42), forwards the backend's answer untouched, and
// answers the two failures the BFF itself can have. The error contract is AR-37/AR-38: every non-2xx
// body is `{ code, context }`, and the browser turns the code into pt-BR text (AR-39). A BFF route
// never rewrites an error body into `{ error }` or `{ message }`.
import { NextRequest, NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env';
import { clientAddressHeaders } from '@/lib/forwarded-for';
import { reportClientError } from '@/lib/report-client-error';
import { isTrustedOrigin } from '@/lib/request-origin';
import { clearSessionCookie, sessionTokenOf, setSessionCookie } from '@/lib/session-cookie';

/** The BFF's own error codes. Every other code comes from the backend, verbatim (AR-38). */
export const BFF_ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',
} as const;

function bffError(code: keyof typeof BFF_ERROR_CODES, status: number): NextResponse {
  return NextResponse.json({ code, context: {} }, { status });
}

/** 401: the browser sent no session cookie, so there is nothing to forward. */
export function unauthenticated(): NextResponse {
  return bffError('UNAUTHENTICATED', 401);
}

/** 403: a state-changing request that did not come from this site (SC-02). */
export function forbidden(): NextResponse {
  return bffError('FORBIDDEN', 403);
}

/**
 * SC-02: answers 403 FORBIDDEN, before anything else happens, when a state-changing request does
 * not come from this site; null when the request may go on. Every route that changes state or
 * sets the cookie calls it first (`proxyToBackend` does).
 */
export function refuseForeignOrigin(request: NextRequest): NextResponse | null {
  return isTrustedOrigin(request) ? null : forbidden();
}

/** 502: the backend could not be reached, or answered with something that is not an API body. */
export function backendUnavailable(): NextResponse {
  return bffError('BACKEND_UNAVAILABLE', 502);
}

/**
 * Calls the backend. `path` is relative to the backend's `/api` prefix and starts with `/`, so
 * `/auth/login` reaches `${BACKEND_API_URL}/api/auth/login`. Rejects when the backend is
 * unreachable; callers that answer the browser use `proxyToBackend` or catch it themselves.
 */
export function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!path.startsWith('/')) {
    throw new Error('backendFetch: path must start with "/" and be relative to /api');
  }
  return fetch(`${serverEnv().backendUrl}/api${path}`, init);
}

// Statuses that cannot carry a body: `new Response(text, { status: 204 })` throws.
const BODYLESS_STATUSES = new Set([101, 204, 205, 304]);

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hands the backend's answer to the browser: same status, same JSON body, byte for byte, so
 * `{ code, context }` arrives untouched (AR-38). An error status whose body is not JSON (a gateway's
 * HTML page, an empty 5xx) is not an API answer and becomes BACKEND_UNAVAILABLE.
 */
export async function forwardBackendResponse(res: Response): Promise<NextResponse> {
  if (BODYLESS_STATUSES.has(res.status)) {
    return new NextResponse(null, { status: res.status });
  }

  let text: string;
  try {
    text = await res.text();
  } catch (error: unknown) {
    reportClientError(error, { where: 'backend response body' });
    return backendUnavailable();
  }

  if (isJson(text)) {
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!res.ok) return backendUnavailable();
  const contentType = res.headers.get('content-type');
  return new NextResponse(text === '' ? null : text, {
    status: res.status,
    ...(contentType ? { headers: { 'content-type': contentType } } : {}),
  });
}

/**
 * The pagination query of a list request (AR-35): only `page` and `pageSize` reach the backend,
 * as sent, so the backend alone validates them (a pageSize over 100 is its 400, not the BFF's).
 */
export function pageQuery(request: NextRequest): string {
  const { searchParams } = request.nextUrl;
  const params = new URLSearchParams();
  for (const name of ['page', 'pageSize']) {
    const value = searchParams.get(name);
    if (value) params.set(name, value);
  }
  return params.toString();
}

interface ProxyOptions {
  /** The route needs a signed-in caller: answer 401 UNAUTHENTICATED here when there is no cookie. */
  auth?: boolean;
  /** Query string for the backend call, without the leading `?`. */
  query?: string;
  /**
   * The route signs the caller in (login, register, the Google exchange and complete): an `accessToken` in the
   * backend's answer becomes the session cookie and is removed from the body (SC-02).
   */
  startsSession?: boolean;
}

/** The body the browser gets once the token has moved into the cookie; the status is the backend's. */
async function startSession(res: Response): Promise<NextResponse> {
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    // not JSON: forwardBackendResponse decides what the browser gets
  }
  const token = typeof body === 'object' && body !== null ? Reflect.get(body, 'accessToken') : null;
  if (!res.ok || typeof token !== 'string' || token === '') return forwardBackendResponse(res);

  const rest = Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(([name]) => name !== 'accessToken'),
  );
  const response = NextResponse.json(rest, { status: res.status });
  setSessionCookie(response, token);
  return response;
}

/** Whether the backend answered 401 UNAUTHENTICATED: the session the cookie carried is dead. */
async function isSessionEnded(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    const body: unknown = await res.clone().json();
    return (
      typeof body === 'object' && body !== null && Reflect.get(body, 'code') === 'UNAUTHENTICATED'
    );
  } catch {
    return false;
  }
}

/**
 * Forwards a BFF request to the backend and returns the backend's answer. The method and the raw
 * body are passed through, so the backend alone validates them and answers with its own code.
 *
 * SC-02: a state-changing request from another origin is refused first (403 FORBIDDEN). On a
 * signed-in route the BFF builds `Authorization: Bearer` from the session cookie; the browser's
 * own `Authorization` header is never read or forwarded. The only headers that reach the backend
 * are that `Authorization`, `Content-Type` and the validated `X-Forwarded-For` chain (the
 * caller's address for the per-origin limits, SC-04; lib/forwarded-for.ts): no cookies, no other
 * headers. A backend 401 UNAUTHENTICATED to a request that carried the cookie clears the cookie
 * on the way out: the session is dead.
 *
 * SC-15: the only thing logged is the route label, the error name and its message; never a body,
 * a header or a token.
 */
export async function proxyToBackend(
  request: NextRequest,
  path: string,
  { auth = false, query, startsSession = false }: ProxyOptions = {},
): Promise<NextResponse> {
  const refused = refuseForeignOrigin(request);
  if (refused) return refused;

  const headers: Record<string, string> = { ...clientAddressHeaders(request) };
  const token = auth ? sessionTokenOf(request) : null;
  if (auth) {
    if (!token) return unauthenticated();
    headers.Authorization = `Bearer ${token}`;
  }

  const body = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
  if (body !== '') headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await backendFetch(query ? `${path}?${query}` : path, {
      method: request.method,
      headers,
      ...(body !== '' ? { body } : {}),
    });
  } catch (error: unknown) {
    reportClientError(error, { where: `api${path} ${request.method}` });
    return backendUnavailable();
  }

  const ended = token !== null && (await isSessionEnded(res));
  const response = await (startsSession ? startSession(res) : forwardBackendResponse(res));
  if (ended) clearSessionCookie(response);
  return response;
}
