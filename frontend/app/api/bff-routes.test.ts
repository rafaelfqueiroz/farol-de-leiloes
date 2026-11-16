// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as auctionByCode } from './auctions/[code]/route';
import { POST as changePassword } from './auth/change-password/route';
import { POST as login } from './auth/login/route';
import { POST as logout } from './auth/logout/route';
import { GET as me } from './auth/me/route';
import { PATCH as completeProfile } from './auth/profile/complete/route';
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
import { POST as cancelSubscription } from './payments/cancel-subscription/route';
import { POST as createCheckoutSession } from './payments/create-checkout-session/route';
import { GET as subscriptionStatus } from './payments/subscription-status/route';
import { DELETE as deleteReminder, PATCH as updateReminder } from './reminders/[id]/route';
import { POST as createReminder } from './reminders/route';
import { DELETE as deleteSavedFilter } from './saved-filters/[id]/route';
import { POST as createSavedFilter } from './saved-filters/route';
import { POST as sendSupport } from './support/route';

// AR-02, AR-42: every route handler under app/api is a thin BFF over the backend. It forwards the
// method, the JSON body and (on signed-in routes only) the Authorization header to the matching
// backend path, and answers 401 UNAUTHENTICATED itself, without calling the backend, when a
// signed-in route gets no token. It also passes Caddy's validated X-Forwarded-For chain on, so the
// backend's per-origin limits (SC-04, BR-001-15) see the browser and not the BFF. The paged list handlers (GET) have their own spec,
// pagination-routes.test.ts.
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
  publicRoute('POST', '/api/auth/register', register),
  publicRoute('POST', '/api/auth/reset-password-request', resetPasswordRequest),
  publicRoute('POST', '/api/auth/reset-password', resetPassword),
  publicRoute('POST', '/api/auth/verify-email', verifyEmail),
  signedInRoute('POST', '/api/auth/logout', logout),
  signedInRoute('GET', '/api/auth/me', me),
  signedInRoute('POST', '/api/auth/change-password', changePassword),
  signedInRoute('POST', '/api/auth/set-password', setPassword),
  signedInRoute('POST', '/api/auth/resend-verification', resendVerification),
  signedInRoute('GET', '/api/auth/verification-status', verificationStatus),
  signedInRoute('PATCH', '/api/auth/profile', updateProfile),
  signedInRoute('GET', '/api/auth/profile/full', fullProfile),
  signedInRoute('PATCH', '/api/auth/profile/complete', completeProfile),
  signedInRoute('POST', '/api/coupons', createCoupon),
  signedInRoute('POST', '/api/coupons/validate', validateCoupon),
  signedInRoute('PATCH', '/api/coupons/c1/invalidate', invalidateCoupon, { id: 'c1' }),
  signedInRoute('POST', '/api/favorites', addFavorite),
  signedInRoute('GET', '/api/favorites/codes', favoriteCodes),
  signedInRoute('DELETE', '/api/favorites/1444400000001', deleteFavorite, {
    code: '1444400000001',
  }),
  signedInRoute('POST', '/api/payments/create-checkout-session', createCheckoutSession),
  signedInRoute('POST', '/api/payments/cancel-subscription', cancelSubscription),
  signedInRoute('GET', '/api/payments/subscription-status', subscriptionStatus),
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

const signedIn = { Authorization: 'Bearer token-a' };

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
    it('forwards the Authorization header to the backend', async () => {
      await call(route, requestFor(route, signedIn));

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(init.headers).toMatchObject(signedIn);
    });

    it('answers 401 UNAUTHENTICATED without calling the backend when signed out', async () => {
      const response = await call(route, requestFor(route));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: 'UNAUTHENTICATED', context: {} });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  } else {
    it('never forwards the Authorization header on a public route', async () => {
      await call(route, requestFor(route, signedIn));

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(init.headers).not.toHaveProperty('Authorization');
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

  it('forwards no cookie and no other header beyond Authorization and X-Forwarded-For', async () => {
    await call(
      route,
      requestFor(route, {
        ...signedIn,
        'X-Forwarded-For': '203.0.113.10',
        Cookie: 'session=secret',
        'X-Real-IP': '198.51.100.1',
        Forwarded: 'for=198.51.100.1',
      }),
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const names = Object.keys(init.headers as object).map((name) => name.toLowerCase());
    expect(
      names.filter((name) => !['authorization', 'content-type', 'x-forwarded-for'].includes(name)),
    ).toEqual([]);
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
