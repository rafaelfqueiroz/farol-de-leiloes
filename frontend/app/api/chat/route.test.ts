// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

// SPEC-006: the AI search is two backend calls: extract the filters from the sentence, then search
// the auctions with them. The paging and the error pass-through are in pagination-routes.test.ts.
const report = vi.hoisted(() => vi.fn());
const fetchMock = vi.fn();

vi.mock('@/lib/report-client-error', () => ({ reportClientError: report }));

beforeEach(() => {
  vi.stubEnv('BACKEND_API_URL', 'http://backend:3000');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  report.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const chat = (body = JSON.stringify({ message: 'casa em Natal' }), headers?: HeadersInit) =>
  POST(
    new NextRequest('http://localhost:3001/api/chat', {
      method: 'POST',
      body,
      ...(headers ? { headers } : {}),
    }),
  );

describe('POST /api/chat', () => {
  it('hands the raw body to the extraction, so the backend alone validates it (AR-38)', async () => {
    fetchMock.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ items: [] }));

    await chat('{"message":"casa"}');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://backend:3000/api/ai/extract-params');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"message":"casa"}',
    });
  });

  it("forwards the caller's validated X-Forwarded-For on both backend calls (SC-04)", async () => {
    fetchMock.mockResolvedValueOnce(json({ city: 'Natal' })).mockResolvedValueOnce(json({}));

    await chat(undefined, { 'X-Forwarded-For': '203.0.113.10' });

    const [extract, search] = fetchMock.mock.calls as [string, RequestInit][];
    expect(extract?.[1].headers).toMatchObject({ 'X-Forwarded-For': '203.0.113.10' });
    expect(search?.[1].headers).toEqual({ 'X-Forwarded-For': '203.0.113.10' });
  });

  it('searches the auctions with every filter the extraction found', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          state: 'RN',
          city: 'Natal',
          neighborhood: 'Ponta Negra',
          modality: 'ONLINE_SALES',
          minPrice: '100000.00',
          maxPrice: '300000.00',
        }),
      )
      .mockResolvedValueOnce(json({ items: [{ code: '1' }], total: 1, page: 1, pageSize: 20 }));

    const response = await chat();

    const search = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(search.origin + search.pathname).toBe('http://backend:3000/api/auctions');
    expect(Object.fromEntries(search.searchParams)).toEqual({
      state: 'RN',
      city: 'Natal',
      neighborhood: 'Ponta Negra',
      modality: 'ONLINE_SALES',
      minPrice: '100000.00',
      maxPrice: '300000.00',
    });
    expect(await response.json()).toMatchObject({ items: [{ code: '1' }], total: 1 });
  });

  it('searches without a filter the extraction did not find', async () => {
    fetchMock.mockResolvedValueOnce(json({ city: 'Natal' })).mockResolvedValueOnce(json({}));

    await chat();

    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).search).toBe('?city=Natal');
  });

  it('answers 502 BACKEND_UNAVAILABLE, and reports it, when the backend cannot be reached', async () => {
    const failure = new TypeError('fetch failed');
    fetchMock.mockRejectedValueOnce(failure);

    const response = await chat();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'BACKEND_UNAVAILABLE', context: {} });
    expect(report).toHaveBeenCalledWith(failure, { where: 'api/chat POST' });
  });

  it('answers 502 BACKEND_UNAVAILABLE when the search itself cannot be reached', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ state: 'RN' }))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const response = await chat();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'BACKEND_UNAVAILABLE', context: {} });
  });

  it("passes the search's own error through untouched", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ state: 'XX' }))
      .mockResolvedValueOnce(
        json({ code: 'VALIDATION_FAILED', context: { fields: ['state'] } }, 400),
      );

    const response = await chat();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'VALIDATION_FAILED',
      context: { fields: ['state'] },
    });
  });
});
