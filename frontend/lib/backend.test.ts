// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportClientError } from './report-client-error';
import {
  authorizationOf,
  backendFetch,
  backendUnavailable,
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

describe('authorizationOf', () => {
  it('returns the header, or null when it is missing or empty', () => {
    expect(authorizationOf(requestTo('/api/x', { headers: { Authorization: 'Bearer t' } }))).toBe(
      'Bearer t',
    );
    expect(authorizationOf(requestTo('/api/x'))).toBeNull();
    expect(authorizationOf(requestTo('/api/x', { headers: { Authorization: '' } }))).toBeNull();
  });
});

describe('proxyToBackend', () => {
  it('forwards method, raw body and Authorization, and returns the backend answer', async () => {
    fetchMock.mockResolvedValue(json({ id: '7' }, 201));
    const req = requestTo('/api/reminders', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', Cookie: 'secret=1', 'X-Other': 'no' },
      body: '{"a":1}',
    });

    const res = await proxyToBackend(req, '/reminders', { auth: true });

    expect(fetchMock).toHaveBeenCalledWith('http://backend:3000/api/reminders', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: '7' });
  });

  it('answers UNAUTHENTICATED without calling the backend when the token is missing', async () => {
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
    await proxyToBackend(requestTo('/api/auth/logout', { method: 'POST' }), '/auth/logout');
    expect(fetchMock).toHaveBeenCalledWith('http://backend:3000/api/auth/logout', {
      method: 'POST',
      headers: {},
    });
  });

  it('does not read a body on DELETE and passes 204 through', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await proxyToBackend(
      requestTo('/api/reminders/1', { method: 'DELETE', headers: { Authorization: 'Bearer t' } }),
      '/reminders/1',
      { auth: true },
    );
    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledWith('http://backend:3000/api/reminders/1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer t' },
    });
  });

  it('forwards a backend error body untouched', async () => {
    const body = { code: 'INVALID_CREDENTIALS', context: {} };
    fetchMock.mockResolvedValue(json(body, 401));
    const res = await proxyToBackend(
      requestTo('/api/auth/login', { method: 'POST', body: '{}' }),
      '/auth/login',
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(body);
  });

  it('answers BACKEND_UNAVAILABLE and logs no payload when the fetch throws (SC-15)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await proxyToBackend(
      requestTo('/api/auth/login', { method: 'POST', body: '{"password":"hunter2"}' }),
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
