// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as me } from '@/app/api/auth/me/route';
import { CookieJar } from '@/test/cookie-jar';
import { SITE_ORIGIN } from '@/test/bff-requests';
import { PLAIN_SESSION_COOKIE } from './session-cookie';

// BR-001-18, SC-02: the BFF is stateless, so it cannot know which cookie the browser holds when a
// slow answer comes back. A response that was started under one session must never touch the
// cookie of another: a data request's 401 does not clear the cookie. Only logout does.
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('BACKEND_API_URL', 'http://backend:3000');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A backend answer the test releases by hand. */
function held() {
  let release!: (response: Response) => void;
  const answer = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}

/** The request a browser holding `jar` sends now. */
const browserRequest = (jar: CookieJar, path: string, method = 'GET') =>
  new NextRequest(`http://localhost:3001${path}`, {
    method,
    headers: {
      Cookie: jar.header(),
      ...(method === 'GET' ? {} : { Origin: SITE_ORIGIN }),
    },
    ...(method === 'POST' && path === '/api/auth/login'
      ? { body: JSON.stringify({ email: 'b@b.com', password: 'secret1' }) }
      : {}),
  });

describe('a late 401 never ends a newer session', () => {
  it('does not clear the cookie a sign-in set while a request started under the old one was in flight', async () => {
    const jar = new CookieJar();
    jar.apply(
      new Response(null, { headers: { 'set-cookie': `${PLAIN_SESSION_COOKIE}=token-x; Path=/` } }),
    );

    // a data request starts with cookie X and the backend's answer is held
    const slow = held();
    fetchMock.mockImplementationOnce(() => slow.answer);
    const lateRequest = me(browserRequest(jar, '/api/auth/me'));

    // meanwhile a sign-in completes and the browser holds cookie Y
    fetchMock.mockResolvedValueOnce(json({ accessToken: 'token-y', user: { _id: 'u2' } }, 201));
    jar.apply(await login(browserRequest(jar, '/api/auth/login', 'POST')));
    expect(jar.get(PLAIN_SESSION_COOKIE)).toBe('token-y');

    // the old session's 401 arrives late
    slow.release(json({ code: 'UNAUTHENTICATED', context: {} }, 401));
    const late = await lateRequest;
    jar.apply(late);

    expect(late.status).toBe(401);
    expect(late.headers.getSetCookie()).toEqual([]);
    expect(jar.get(PLAIN_SESSION_COOKIE)).toBe('token-y');
  });

  it('still clears the cookie on an explicit logout', async () => {
    const jar = new CookieJar();
    jar.apply(
      new Response(null, { headers: { 'set-cookie': `${PLAIN_SESSION_COOKIE}=token-y; Path=/` } }),
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    jar.apply(await logout(browserRequest(jar, '/api/auth/logout', 'POST')));

    expect(jar.get(PLAIN_SESSION_COOKIE)).toBeUndefined();
    expect(jar.header()).toBe('');
  });
});
