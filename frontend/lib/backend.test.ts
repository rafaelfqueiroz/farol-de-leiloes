// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportClientError } from './report-client-error';
import { PLAIN_SESSION_COOKIE } from './session-cookie';
import { sameSite, sessionCookie, signedInSameSite } from '@/test/bff-requests';
import {
  backendFetch,
  backendUnavailable,
  forbidden,
  forwardBackendResponse,
  pageQuery,
  proxyToBackend,
  unauthenticated,
} from './backend';

vi.mock('./report-client-error', () => ({ reportClientError: vi.fn() }));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('BACKEND_API_URL', 'http://backend:3000');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(reportClientError).mockClear();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const requestTo = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`http://localhost:3001${path}`, init);

describe('BFF error bodies', () => {
  it('answers 401 UNAUTHENTICATED with an empty context', async () => {
    const res = unauthenticated();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHENTICATED', context: {} });
  });

  it('answers 502 BACKEND_UNAVAILABLE with an empty context', async () => {
    const res = backendUnavailable();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ code: 'BACKEND_UNAVAILABLE', context: {} });
  });

  it('answers 403 FORBIDDEN with an empty context', async () => {
    const res = forbidden();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'FORBIDDEN', context: {} });
  });
});

describe('backendFetch', () => {
  it('prefixes the path with the backend origin and /api', async () => {
    fetchMock.mockResolvedValue(json({}));
    await backendFetch('/auth/login', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledWith('http://backend:3000/api/auth/login', {
      method: 'POST',
    });
  });

  it('rejects a path that is not relative to /api', () => {
    expect(() => backendFetch('auth/login')).toThrow(/must start with/);
  });

  it('lets a network failure reject to the caller', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(backendFetch('/x')).rejects.toThrow('fetch failed');
  });
});

describe('forwardBackendResponse', () => {
  it('passes a backend error status and { code, context } body through verbatim', async () => {
    const body = { code: 'PLAN_LIMIT_REACHED', context: { limit: 5 } };
    const res = await forwardBackendResponse(json(body, 403));
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual(body);
  });

  it('keeps the exact bytes of a success body and its status', async () => {
    const text = '{"items":[{"code":"1"}],"total":1}';
    const res = await forwardBackendResponse(new Response(text, { status: 201 }));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe(text);
  });

  it.each([204, 205, 304])('keeps %i without a body', async (status) => {
    const res = await forwardBackendResponse(new Response(null, { status }));
    expect(res.status).toBe(status);
    expect(await res.text()).toBe('');
  });

  it('turns an error that is not JSON (gateway page) into BACKEND_UNAVAILABLE', async () => {
    const res = await forwardBackendResponse(
      new Response('<html>Bad Gateway</html>', { status: 502 }),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ code: 'BACKEND_UNAVAILABLE', context: {} });
  });

  it('turns an empty error body into BACKEND_UNAVAILABLE', async () => {
    const res = await forwardBackendResponse(new Response('', { status: 500 }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ code: 'BACKEND_UNAVAILABLE', context: {} });
  });

  it('passes a non-JSON success body through with its content type', async () => {
    const res = await forwardBackendResponse(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(await res.text()).toBe('ok');
  });

  it('passes an empty success body through as empty', async () => {
    const res = await forwardBackendResponse(new Response('', { status: 200 }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('turns a body that cannot be read into BACKEND_UNAVAILABLE', async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('socket closed'));
        },
      }),
      { status: 200 },
    );
    const res = await forwardBackendResponse(broken);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ code: 'BACKEND_UNAVAILABLE', context: {} });
  });
});

const setCookieOf = (res: Response) => res.headers.getSetCookie();

describe('proxyToBackend', () => {
  it('forwards method and raw body, builds Authorization from the session cookie, and returns the backend answer', async () => {
    fetchMock.mockResolvedValue(json({ id: '7' }, 201));
    const req = requestTo('/api/reminders', {
      method: 'POST',
      headers: { ...signedInSameSite, 'X-Other': 'no' },
      body: '{"a":1}',
    });

    const res = await proxyToBackend(req, '/reminders', { auth: true });

    expect(fetchMock).toHaveBeenCalledWith('http://backend:3000/api/reminders', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-a', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: '7' });
  });

  it("never reads or forwards the browser's own Authorization header (SC-02)", async () => {
    fetchMock.mockResolvedValue(json({}));
    await proxyToBackend(
      requestTo('/api/favorites', {
        headers: { ...sessionCookie('from-cookie'), Authorization: 'Bearer from-browser' },
      }),
      '/favorites',
      { auth: true },
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({ Authorization: 'Bearer from-cookie' });

    // without the cookie that header alone does not sign anyone in
    fetchMock.mockClear();
    const res = await proxyToBackend(
      requestTo('/api/favorites', { headers: { Authorization: 'Bearer from-browser' } }),
      '/favorites',
      { auth: true },
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards no cookie and no Authorization on a public route', async () => {
    fetchMock.mockResolvedValue(json({}));
    await proxyToBackend(
      requestTo('/api/auctions/1', { headers: { ...sessionCookie(), Authorization: 'Bearer x' } }),
      '/auctions/1',
    );
    expect(fetchMock).toHaveBeenCalledWith('http://backend:3000/api/auctions/1', {
      method: 'GET',
      headers: {},
    });
  });

  it('answers UNAUTHENTICATED without calling the backend when the cookie is missing', async () => {
    const res = await proxyToBackend(requestTo('/api/favorites'), '/favorites', { auth: true });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHENTICATED', context: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends no Authorization or body on a public GET, and appends the query', async () => {
    fetchMock.mockResolvedValue(json({ items: [], total: 0 }));
    await proxyToBackend(requestTo('/api/search'), '/auctions', { query: 'state=SP&limit=10' });
    expect(fetchMock).toHaveBeenCalledWith('http://backend:3000/api/auctions?state=SP&limit=10', {
      method: 'GET',
      headers: {},
    });
  });

  it('sends no body or content type for a body-less POST', async () => {
    fetchMock.mockResolvedValue(json({ message: 'ok' }));
    await proxyToBackend(
      requestTo('/api/auth/resend-verification', { method: 'POST', headers: sameSite }),
      '/auth/resend-verification',
    );
    expect(fetchMock).toHaveBeenCalledWith('http://backend:3000/api/auth/resend-verification', {
      method: 'POST',
      headers: {},
    });
  });

  it('does not read a body on DELETE and passes 204 through', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await proxyToBackend(
      requestTo('/api/reminders/1', { method: 'DELETE', headers: signedInSameSite }),
      '/reminders/1',
      { auth: true },
    );
    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledWith('http://backend:3000/api/reminders/1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token-a' },
    });
  });

  it('forwards a backend error body untouched', async () => {
    const body = { code: 'INVALID_CREDENTIALS', context: {} };
    fetchMock.mockResolvedValue(json(body, 401));
    const res = await proxyToBackend(
      requestTo('/api/auth/login', { method: 'POST', headers: sameSite, body: '{}' }),
      '/auth/login',
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(body);
    expect(setCookieOf(res)).toEqual([]);
  });

  it('answers BACKEND_UNAVAILABLE and logs no payload when the fetch throws (SC-15)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await proxyToBackend(
      requestTo('/api/auth/login', {
        method: 'POST',
        headers: sameSite,
        body: '{"password":"hunter2"}',
      }),
      '/auth/login',
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ code: 'BACKEND_UNAVAILABLE', context: {} });
    // Only the error and a route label are reported: never the body, headers or token.
    expect(reportClientError).toHaveBeenCalledTimes(1);
    expect(reportClientError).toHaveBeenCalledWith(expect.any(TypeError), {
      where: 'api/auth/login POST',
    });
  });

  describe('Origin check (SC-02)', () => {
    it.each([
      ['another origin', { Origin: 'https://evil.example' }],
      ['the null origin', { Origin: 'null' }],
      ['no Origin and no Sec-Fetch-Site', {}],
      ['a cross-site fetch without Origin', { 'Sec-Fetch-Site': 'cross-site' }],
    ])(
      'refuses a state-changing request from %s with 403 FORBIDDEN, before the backend',
      async (_name, headers) => {
        const res = await proxyToBackend(
          requestTo('/api/favorites', {
            method: 'POST',
            headers: { ...sessionCookie(), ...headers },
            body: '{}',
          }),
          '/favorites',
          { auth: true },
        );
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ code: 'FORBIDDEN', context: {} });
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('refuses before answering 401: a foreign origin learns nothing about the session', async () => {
      const res = await proxyToBackend(
        requestTo('/api/favorites', {
          method: 'POST',
          headers: { Origin: 'https://evil.example' },
          body: '{}',
        }),
        '/favorites',
        { auth: true },
      );
      expect(res.status).toBe(403);
    });

    it('lets Sec-Fetch-Site: same-origin stand in for a missing Origin', async () => {
      fetchMock.mockResolvedValue(json({}));
      const res = await proxyToBackend(
        requestTo('/api/support', {
          method: 'POST',
          headers: { ...sessionCookie(), 'Sec-Fetch-Site': 'same-origin' },
          body: '{}',
        }),
        '/support',
        { auth: true },
      );
      expect(res.status).toBe(200);
    });

    it('does not check a GET', async () => {
      fetchMock.mockResolvedValue(json({}));
      const res = await proxyToBackend(
        requestTo('/api/auth/me', {
          headers: { ...sessionCookie(), Origin: 'https://evil.example' },
        }),
        '/auth/me',
        { auth: true },
      );
      expect(res.status).toBe(200);
    });
  });

  describe('a dead session (SC-02, BR-001-18)', () => {
    const signedInGet = () => requestTo('/api/auth/me', { headers: sessionCookie() });

    it('clears the cookie when the backend answers 401 UNAUTHENTICATED to a request that carried it', async () => {
      fetchMock.mockResolvedValue(json({ code: 'UNAUTHENTICATED', context: {} }, 401));

      const res = await proxyToBackend(signedInGet(), '/auth/me', { auth: true });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ code: 'UNAUTHENTICATED', context: {} });
      const [cleared] = setCookieOf(res);
      expect(cleared).toContain(`${PLAIN_SESSION_COOKIE}=;`);
      expect(cleared).toMatch(/Max-Age=0/i);
    });

    it('keeps the cookie on any other 401 (a wrong current password is not a dead session)', async () => {
      fetchMock.mockResolvedValue(json({ code: 'INVALID_CREDENTIALS', context: {} }, 401));
      const res = await proxyToBackend(signedInGet(), '/auth/me', { auth: true });
      expect(setCookieOf(res)).toEqual([]);
    });

    it('keeps the cookie on a 401 that is not an API body', async () => {
      fetchMock.mockResolvedValue(new Response('nope', { status: 401 }));
      const res = await proxyToBackend(signedInGet(), '/auth/me', { auth: true });
      expect(setCookieOf(res)).toEqual([]);
    });

    it('does not touch cookies on a public route', async () => {
      fetchMock.mockResolvedValue(json({ code: 'UNAUTHENTICATED', context: {} }, 401));
      const res = await proxyToBackend(
        requestTo('/api/auctions/1', { headers: sessionCookie() }),
        '/auctions/1',
      );
      expect(setCookieOf(res)).toEqual([]);
    });
  });

  describe('startsSession (login, register, the Google exchange)', () => {
    const signIn = (body: string = '{}') =>
      requestTo('/api/auth/login', { method: 'POST', headers: sameSite, body });

    it('moves the backend accessToken into the cookie and answers without it', async () => {
      fetchMock.mockResolvedValue(json({ accessToken: 'jwt-1', user: { _id: 'u1' } }, 201));

      const res = await proxyToBackend(signIn(), '/auth/login', { startsSession: true });

      expect(res.status).toBe(201);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ user: { _id: 'u1' } });
      expect(text).not.toContain('jwt-1');
      const [cookie] = setCookieOf(res);
      expect(cookie).toContain(`${PLAIN_SESSION_COOKIE}=jwt-1`);
    });

    it('keeps the other fields of a Google exchange that signed in', async () => {
      fetchMock.mockResolvedValue(
        json({ status: 'signed_in', accessToken: 'jwt-2', user: { _id: 'u2' } }),
      );
      const res = await proxyToBackend(signIn(), '/auth/google/exchange', { startsSession: true });
      expect(await res.json()).toEqual({ status: 'signed_in', user: { _id: 'u2' } });
      expect(setCookieOf(res)).toHaveLength(1);
    });

    it('sets no cookie when the Google exchange needs the terms', async () => {
      const body = { status: 'terms_required', email: 'a@b.c', name: 'A' };
      fetchMock.mockResolvedValue(json(body));
      const res = await proxyToBackend(signIn(), '/auth/google/exchange', { startsSession: true });
      expect(await res.json()).toEqual(body);
      expect(setCookieOf(res)).toEqual([]);
    });

    it('sets no cookie on a failure and passes its body through', async () => {
      const body = { code: 'INVALID_CREDENTIALS', context: {} };
      fetchMock.mockResolvedValue(json(body, 401));
      const res = await proxyToBackend(signIn(), '/auth/login', { startsSession: true });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(body);
      expect(setCookieOf(res)).toEqual([]);
    });

    it('passes a success body that is not JSON through, without a cookie', async () => {
      fetchMock.mockResolvedValue(
        new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
      );
      const res = await proxyToBackend(signIn(), '/auth/login', { startsSession: true });
      expect(await res.text()).toBe('ok');
      expect(setCookieOf(res)).toEqual([]);
    });

    it('is refused from another origin before the backend is called', async () => {
      const res = await proxyToBackend(
        requestTo('/api/auth/login', {
          method: 'POST',
          headers: { Origin: 'https://evil.example' },
          body: '{}',
        }),
        '/auth/login',
        { startsSession: true },
      );
      expect(res.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

describe('pageQuery', () => {
  it('keeps only page and pageSize (AR-35)', () => {
    const request = requestTo('/api/reminders?page=2&pageSize=50&owner=other&limit=5');
    expect(pageQuery(request)).toBe('page=2&pageSize=50');
  });

  it('does not validate: an out-of-range pageSize is the backend to reject', () => {
    expect(pageQuery(requestTo('/api/reminders?pageSize=500'))).toBe('pageSize=500');
  });

  it('is empty when the request has no pagination', () => {
    expect(pageQuery(requestTo('/api/reminders'))).toBe('');
  });
});
