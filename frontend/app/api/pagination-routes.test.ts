// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as chat } from './chat/route';
import { GET as coupons } from './coupons/route';
import { GET as favorites } from './favorites/route';
import { GET as favoriteCodes } from './favorites/codes/route';
import { GET as reminders } from './reminders/route';
import { GET as savedFilters } from './saved-filters/route';
import { GET as search } from './search/route';

// AR-35: the BFF forwards `page` and `pageSize` to the backend as sent and nothing else (the old
// `limit`/`offset` are rejected by the backend, so they must never reach it).
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('BACKEND_API_URL', 'http://backend:3000');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }), {
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

const request = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`http://localhost:3001${path}`, init);
const signedIn = { headers: { Authorization: 'Bearer token-a' } };
const calledUrl = (call = 0) => String(fetchMock.mock.calls[call]?.[0]);

describe('GET /api/search', () => {
  it('forwards the filters, page and pageSize, and drops limit and offset', async () => {
    await search(request('/api/search?state=SP&city=Natal&page=3&pageSize=50&limit=5&offset=10'));

    const url = new URL(calledUrl());
    expect(url.origin + url.pathname).toBe('http://backend:3000/api/auctions');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      state: 'SP',
      city: 'Natal',
      page: '3',
      pageSize: '50',
    });
  });
});

describe.each([
  ['favorites', favorites, '/api/favorites'],
  ['reminders', reminders, '/api/reminders'],
  ['saved filters', savedFilters, '/api/saved-filters'],
  ['coupons', coupons, '/api/coupons'],
])('GET %s', (_name, handler, path) => {
  it('forwards page and pageSize and nothing else', async () => {
    await handler(request(`${path}?page=2&pageSize=100&owner=other`, signedIn));

    expect(calledUrl()).toBe(`http://backend:3000${path}?page=2&pageSize=100`);
  });

  it('forwards no query for a request without pagination', async () => {
    await handler(request(path, signedIn));

    expect(calledUrl()).toBe(`http://backend:3000${path}`);
  });

  it('answers 401 UNAUTHENTICATED without calling the backend when signed out', async () => {
    const response = await handler(request(path));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'UNAUTHENTICATED', context: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/favorites/codes', () => {
  it('proxies the codes of the favourites, signed in', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ codes: ['A1', 'A2'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await favoriteCodes(request('/api/favorites/codes', signedIn));

    expect(calledUrl()).toBe('http://backend:3000/api/favorites/codes');
    expect(await response.json()).toEqual({ codes: ['A1', 'A2'] });
  });

  it('answers 401 UNAUTHENTICATED when signed out', async () => {
    const response = await favoriteCodes(request('/api/favorites/codes'));
    expect(response.status).toBe(401);
  });
});

describe('POST /api/chat', () => {
  it('searches with the page and pageSize the AI extraction answered with', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: 'RN', page: 2, pageSize: 20 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], total: 0, page: 2, pageSize: 20 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const response = await chat(
      request('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'casa em Natal' }) }),
    );

    expect(calledUrl(0)).toBe('http://backend:3000/api/ai/extract-params');
    expect(Object.fromEntries(new URL(calledUrl(1)).searchParams)).toEqual({
      state: 'RN',
      page: '2',
      pageSize: '20',
    });
    expect(await response.json()).toMatchObject({ page: 2, pageSize: 20 });
  });

  it('does not send limit or offset even when the extraction still carries them', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: 'RN', limit: 10, offset: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await chat(request('/api/chat', { method: 'POST', body: '{}' }));

    expect(Object.fromEntries(new URL(calledUrl(1)).searchParams)).toEqual({ state: 'RN' });
  });

  it('forwards an extraction error as { code, context } untouched (AR-38)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'VALIDATION_FAILED', context: { fields: ['message'] } }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await chat(request('/api/chat', { method: 'POST', body: '{}' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'VALIDATION_FAILED',
      context: { fields: ['message'] },
    });
  });
});
