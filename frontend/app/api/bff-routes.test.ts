// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as auctionByCode } from './auctions/[code]/route';
import { POST as changePassword } from './auth/change-password/route';
import { POST as googleCancel } from './auth/google/cancel/route';
import { POST as googleComplete } from './auth/google/complete/route';
import { POST as googleExchange } from './auth/google/exchange/route';
import { POST as login } from './auth/login/route';
import { POST as logout } from './auth/logout/route';
import { GET as me } from './auth/me/route';
import { GET as fullProfile } from './auth/profile/full/route';
import { PATCH as updateProfile } from './auth/profile/route';
import { POST as register } from './auth/register/route';
import { POST as resendVerification } from './auth/resend-verification/route';
import { POST as resetPasswordRequest } from './auth/reset-password-request/route';
import { POST as resetPassword } from './auth/reset-password/route';
import { POST as setPassword } from './auth/set-password/route';
import { GET as verificationStatus } from './auth/verification-status/route';
import { POST as verifyEmail } from './auth/verify-email/route';
import { PATCH as invalidateCoupon } from './coupons/[id]/invalidate/route';
import { POST as createCoupon } from './coupons/route';
import { POST as validateCoupon } from './coupons/validate/route';
import { DELETE as deleteFavorite } from './favorites/[code]/route';
import { GET as favoriteCodes } from './favorites/codes/route';
import { POST as addFavorite } from './favorites/route';
import { GET as officeSubscription } from './office/subscription/route';
import { POST as billingPortal } from './office/subscription/billing-portal/route';
import { POST as cancelSubscription } from './office/subscription/cancel/route';
import { POST as changePlan } from './office/subscription/change/route';
import { POST as changePreview } from './office/subscription/change-preview/route';
import { POST as startCheckout } from './office/subscription/checkout/route';
import { POST as undoCancel } from './office/subscription/undo-cancel/route';
import { GET as plans } from './plans/route';
import { GET as checkoutStatus } from './subscriptions/checkout/[ref]/status/route';
import { DELETE as deleteReminder, PATCH as updateReminder } from './reminders/[id]/route';
import { POST as createReminder } from './reminders/route';
import { DELETE as deleteSavedFilter } from './saved-filters/[id]/route';
import { POST as createSavedFilter } from './saved-filters/route';
import { POST as sendSupport } from './support/route';
import { PLAIN_SESSION_COOKIE } from '@/lib/session-cookie';
import { sameSite, sessionCookie } from '@/test/bff-requests';

// AR-02, AR-42, SC-02: every route handler under app/api is a thin BFF over the backend. It
// forwards the method and the JSON body to the matching backend path, builds the Authorization
// header from the session cookie on signed-in routes only (the browser's own Authorization header
// is ignored), passes Caddy's validated X-Forwarded-For chain on (SC-04, BR-001-15: the
// backend's per-origin limits see the browser and not the BFF), refuses a state-changing request from another origin with 403 FORBIDDEN, and
// answers 401 UNAUTHENTICATED itself, without calling the backend, when a signed-in route gets no
// cookie. The paged list handlers (GET) have their own spec, pagination-routes.test.ts; login,
// register, the Google exchange and logout, which set or clear the cookie, are at the end.
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('BACKEND_API_URL', 'http://backend:3000');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Handler = (request: NextRequest, context: never) => Promise<Response>;

interface RouteCase {
  name: string;
  handler: Handler;
  method: Method;
  /** The path the browser calls. */
  url: string;
  /** The dynamic segment, when the route has one. */
  params?: Record<string, string>;
  /** The backend path (after `/api`) the handler must reach. */
  backendPath: string;
  /** Whether the route needs a signed-in caller. */
  auth: boolean;
}

const publicRoute = (
  method: Method,
  url: string,
  handler: Handler,
  params?: Record<string, string>,
): RouteCase => ({
  name: `${method} ${url}`,
  handler,
  method,
  url,
  ...(params ? { params } : {}),
  backendPath: url.replace(/^\/api/, ''),
  auth: false,
});

const signedInRoute = (
  method: Method,
  url: string,
  handler: Handler,
  params?: Record<string, string>,
): RouteCase => ({ ...publicRoute(method, url, handler, params), auth: true });

const routes: RouteCase[] = [
  publicRoute('GET', '/api/auctions/1444400000001', auctionByCode, { code: '1444400000001' }),
  publicRoute('POST', '/api/auth/login', login),
  publicRoute('POST', '/api/auth/google/exchange', googleExchange),
  publicRoute('POST', '/api/auth/google/complete', googleComplete),
  publicRoute('POST', '/api/auth/google/cancel', googleCancel),
  publicRoute('POST', '/api/auth/register', register),
  publicRoute('POST', '/api/auth/reset-password-request', resetPasswordRequest),
  publicRoute('POST', '/api/auth/reset-password', resetPassword),
  publicRoute('POST', '/api/auth/verify-email', verifyEmail),
  signedInRoute('GET', '/api/auth/me', me),
  signedInRoute('POST', '/api/auth/change-password', changePassword),
  signedInRoute('POST', '/api/auth/set-password', setPassword),
  signedInRoute('POST', '/api/auth/resend-verification', resendVerification),
  signedInRoute('GET', '/api/auth/verification-status', verificationStatus),
  signedInRoute('PATCH', '/api/auth/profile', updateProfile),
  signedInRoute('GET', '/api/auth/profile/full', fullProfile),
  signedInRoute('POST', '/api/coupons', createCoupon),
  signedInRoute('POST', '/api/coupons/validate', validateCoupon),
  signedInRoute('PATCH', '/api/coupons/c1/invalidate', invalidateCoupon, { id: 'c1' }),
  signedInRoute('POST', '/api/favorites', addFavorite),
  signedInRoute('GET', '/api/favorites/codes', favoriteCodes),
  signedInRoute('DELETE', '/api/favorites/1444400000001', deleteFavorite, {
    code: '1444400000001',
  }),
  // SPEC-012: the plans are public; everything about an office's plan needs a session
  publicRoute('GET', '/api/plans', plans),
  signedInRoute('GET', '/api/office/subscription', officeSubscription),
  signedInRoute('POST', '/api/office/subscription/checkout', startCheckout),
  signedInRoute('POST', '/api/office/subscription/change', changePlan),
  signedInRoute('POST', '/api/office/subscription/change-preview', changePreview),
  signedInRoute('POST', '/api/office/subscription/cancel', cancelSubscription),
  signedInRoute('POST', '/api/office/subscription/undo-cancel', undoCancel),
  signedInRoute('POST', '/api/office/subscription/billing-portal', billingPortal),
  signedInRoute(
    'GET',
    '/api/subscriptions/checkout/64b7f0000000000000000a01/status',
    checkoutStatus,
    {
      ref: '64b7f0000000000000000a01',
    },
  ),
  signedInRoute('POST', '/api/reminders', createReminder),
  signedInRoute('PATCH', '/api/reminders/r1', updateReminder, { id: 'r1' }),
  signedInRoute('DELETE', '/api/reminders/r1', deleteReminder, { id: 'r1' }),
  signedInRoute('POST', '/api/saved-filters', createSavedFilter),
  signedInRoute('DELETE', '/api/saved-filters/f1', deleteSavedFilter, { id: 'f1' }),
  signedInRoute('POST', '/api/support', sendSupport),
];

const hasBody = (method: string) => method !== 'GET' && method !== 'DELETE';

function requestFor(route: RouteCase, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3001${route.url}`, {
    method: route.method,
    headers: hasBody(route.method) ? { 'Content-Type': 'application/json', ...headers } : headers,
    ...(hasBody(route.method) ? { body: JSON.stringify({ field: 'value' }) } : {}),
  });
}

const call = (route: RouteCase, request: NextRequest) =>
  route.handler(request, { params: Promise.resolve(route.params ?? {}) } as never);

// a same-site browser request, with the session cookie once signed in
const signedOut = sameSite;
const signedIn = { ...sameSite, ...sessionCookie('token-a') };

describe.each(routes)('$name', (route) => {
  it('proxies to the matching backend path with the same method and body', async () => {
    const response = await call(route, requestFor(route, signedIn));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://backend:3000/api${route.backendPath}`);
    expect(init.method).toBe(route.method);
    if (hasBody(route.method)) {
      expect(init.body).toBe(JSON.stringify({ field: 'value' }));
    } else {
      expect(init.body).toBeUndefined();
    }
  });

  if (route.auth) {
    it('builds the Authorization header from the session cookie', async () => {
      await call(route, requestFor(route, signedIn));

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(init.headers).toMatchObject({ Authorization: 'Bearer token-a' });
      expect(init.headers).not.toHaveProperty('Cookie');
    });

    it("ignores the browser's own Authorization header (SC-02)", async () => {
      await call(
        route,
        requestFor(route, { ...signedIn, Authorization: 'Bearer from-the-browser' }),
      );

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(init.headers).toMatchObject({ Authorization: 'Bearer token-a' });
      expect(JSON.stringify(init.headers)).not.toContain('from-the-browser');
    });

    it('does not sign anyone in on an Authorization header alone', async () => {
      const response = await call(
        route,
        requestFor(route, { ...sameSite, Authorization: 'Bearer from-the-browser' }),
      );

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not touch the session cookie when the backend says the session is dead (BR-001-18)', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'UNAUTHENTICATED', context: {} }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const response = await call(route, requestFor(route, signedIn));

      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
    });

    it('answers 401 UNAUTHENTICATED without calling the backend when signed out', async () => {
      const response = await call(route, requestFor(route, signedOut));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: 'UNAUTHENTICATED', context: {} });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  } else {
    it('never forwards the Authorization header or the cookie on a public route', async () => {
      await call(
        route,
        requestFor(route, { ...signedIn, Authorization: 'Bearer from-the-browser' }),
      );

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(init.headers).not.toHaveProperty('Authorization');
      expect(init.headers).not.toHaveProperty('Cookie');
    });
  }

  if (route.method !== 'GET') {
    it('refuses a request from another origin with 403 FORBIDDEN, without calling the backend (SC-02)', async () => {
      const response = await call(
        route,
        requestFor(route, { ...sessionCookie(), Origin: 'https://evil.example' }),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ code: 'FORBIDDEN', context: {} });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("forwards the caller's X-Forwarded-For chain, validated and unchanged (SC-04)", async () => {
    await call(route, requestFor(route, { ...signedIn, 'X-Forwarded-For': '203.0.113.10' }));

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ 'X-Forwarded-For': '203.0.113.10' });
  });

  it('forwards no X-Forwarded-For when the chain is absent or has an invalid entry', async () => {
    await call(route, requestFor(route, signedIn));
    await call(route, requestFor(route, { ...signedIn, 'X-Forwarded-For': '203.0.113.10, nope' }));

    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(init.headers).not.toHaveProperty('X-Forwarded-For');
    }
  });

  it('forwards the cookie-built Authorization and the X-Forwarded-For chain together, and nothing else', async () => {
    await call(
      route,
      requestFor(route, {
        ...signedIn,
        // other cookies ride along in the same header; none of them may reach the backend
        Cookie: `${signedIn.Cookie}; analytics=secret`,
        'X-Forwarded-For': '203.0.113.10',
        Authorization: 'Bearer from-the-browser',
        'X-Real-IP': '198.51.100.1',
        Forwarded: 'for=198.51.100.1',
      }),
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ 'X-Forwarded-For': '203.0.113.10' });
    if (route.auth) expect(init.headers).toMatchObject({ Authorization: 'Bearer token-a' });
    const names = Object.keys(init.headers as object).map((name) => name.toLowerCase());
    expect(
      names.filter((name) => !['authorization', 'content-type', 'x-forwarded-for'].includes(name)),
    ).toEqual([]);
    expect(JSON.stringify(init.headers)).not.toMatch(/secret|from-the-browser/);
  });

  it("passes the backend's error body and status through untouched (AR-38)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'NOT_FOUND', context: { what: 'x' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await call(route, requestFor(route, signedIn));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'NOT_FOUND', context: { what: 'x' } });
  });

  it('answers 502 BACKEND_UNAVAILABLE when the backend cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const response = await call(route, requestFor(route, signedIn));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'BACKEND_UNAVAILABLE', context: {} });
  });
});

describe('dynamic segments', () => {
  it.each([
    ['GET /api/auctions/[code]', auctionByCode, 'GET', 'a/b?c', '/auctions/a%2Fb%3Fc'],
    ['DELETE /api/favorites/[code]', deleteFavorite, 'DELETE', 'a/b', '/favorites/a%2Fb'],
    [
      'PATCH /api/coupons/[id]/invalidate',
      invalidateCoupon,
      'PATCH',
      '../x',
      '/coupons/..%2Fx/invalidate',
    ],
    ['DELETE /api/reminders/[id]', deleteReminder, 'DELETE', '../x', '/reminders/..%2Fx'],
    [
      'DELETE /api/saved-filters/[id]',
      deleteSavedFilter,
      'DELETE',
      '../x',
      '/saved-filters/..%2Fx',
    ],
  ] as const)(
    '%s encodes the segment so it cannot reshape the backend path',
    async (_name, handler, method, segment, expected) => {
      const request = new NextRequest('http://localhost:3001/api/x', {
        method,
        headers: signedIn,
        ...(method === 'PATCH' ? { body: '{}' } : {}),
      });

      await (handler as Handler)(request, {
        params: Promise.resolve({ code: segment, id: segment }),
      } as never);

      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`http://backend:3000/api${expected}`);
    },
  );
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const post = (url: string, headers: Record<string, string>, body: unknown = {}) =>
  new NextRequest(`http://localhost:3001${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const setCookies = (response: Response) => response.headers.getSetCookie();

describe('the routes that start the session (SC-02, BR-001-17)', () => {
  it.each([
    ['login', login, '/api/auth/login', '/auth/login'],
    ['register', register, '/api/auth/register', '/auth/register'],
    ['Google exchange', googleExchange, '/api/auth/google/exchange', '/auth/google/exchange'],
    ['Google complete', googleComplete, '/api/auth/google/complete', '/auth/google/complete'],
  ] as const)(
    '%s sets the httpOnly cookie from the backend token and answers without the token',
    async (_name, handler, url, backendPath) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ status: 'signed_in', accessToken: 'jwt-secret', user: { _id: 'u1' } }, 201),
      );

      const response = await handler(post(url, sameSite, { email: 'a@b.c' }));

      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`http://backend:3000/api${backendPath}`);
      expect(response.status).toBe(201);
      const text = await response.text();
      expect(text).not.toContain('jwt-secret');
      expect(text).not.toContain('accessToken');
      expect(JSON.parse(text)).toEqual({ status: 'signed_in', user: { _id: 'u1' } });
      const [cookie] = setCookies(response);
      expect(cookie).toContain(`${PLAIN_SESSION_COOKIE}=jwt-secret`);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=lax/i);
    },
  );

  it('the Google exchange sets no cookie when the terms are still to be accepted', async () => {
    const body = { status: 'terms_required', email: 'a@b.c', name: 'A' };
    fetchMock.mockResolvedValueOnce(jsonResponse(body));

    const response = await googleExchange(
      post('/api/auth/google/exchange', sameSite, { code: 'c' }),
    );

    expect(await response.json()).toEqual(body);
    expect(setCookies(response)).toEqual([]);
  });

  it('login passes a refusal through and sets no cookie', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'INVALID_CREDENTIALS', context: {} }, 401),
    );

    const response = await login(post('/api/auth/login', sameSite));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'INVALID_CREDENTIALS', context: {} });
    expect(setCookies(response)).toEqual([]);
  });
});

describe('POST /api/auth/logout (BR-001-18, SC-02)', () => {
  const logoutRequest = (headers: Record<string, string>) => post('/api/auth/logout', headers);

  it('ends the session on the backend with the cookie token and clears the cookie', async () => {
    const response = await logout(logoutRequest(signedIn));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://backend:3000/api/auth/logout');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer token-a' } });
    expect(response.status).toBe(204);
    expect(setCookies(response).join(';')).toMatch(
      new RegExp(`${PLAIN_SESSION_COOKIE}=;.*Max-Age=0`, 'i'),
    );
  });

  it('clears the cookie without calling the backend when there is none', async () => {
    const response = await logout(logoutRequest(sameSite));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(204);
    expect(setCookies(response)).toHaveLength(1);
  });

  it('clears the cookie even when the backend cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const response = await logout(logoutRequest(signedIn));

    expect(response.status).toBe(204);
    expect(setCookies(response).join(';')).toMatch(/Max-Age=0/i);
  });

  it('clears the cookie even when the backend refuses the token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'UNAUTHENTICATED', context: {} }, 401));

    const response = await logout(logoutRequest(signedIn));

    expect(response.status).toBe(204);
    expect(setCookies(response).join(';')).toMatch(/Max-Age=0/i);
  });

  it('is refused from another origin, and keeps the cookie and the session', async () => {
    const response = await logout(
      logoutRequest({ ...sessionCookie(), Origin: 'https://evil.example' }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'FORBIDDEN', context: {} });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setCookies(response)).toEqual([]);
  });
});
