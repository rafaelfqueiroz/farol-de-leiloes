// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_LEGAL } from '@/test/legal-fixtures';

const report = vi.hoisted(() => vi.fn());
vi.mock('@/lib/report-client-error', () => ({ reportClientError: report }));

import { fetchCurrentLegal } from './legal-server';

const fetchMock = vi.fn();

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

describe('fetchCurrentLegal (SPEC-010 BR-010-02)', () => {
  it('reads the public endpoint, with no cookie and no Authorization, and validates the answer', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(CURRENT_LEGAL), { status: 200 }));

    const legal = await fetchCurrentLegal();

    expect(legal).toEqual(CURRENT_LEGAL);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://backend:3000/api/legal/current');
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization|cookie/i);
  });

  it('keeps only the fields the pages use: the hash is not part of the contract it relies on', async () => {
    const withHash = {
      terms: { ...CURRENT_LEGAL.terms, contentHash: 'abc' },
      privacy: { ...CURRENT_LEGAL.privacy, contentHash: 'def' },
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(withHash), { status: 200 }));

    expect(await fetchCurrentLegal()).toEqual(CURRENT_LEGAL);
  });

  it.each([
    ['an error status', new Response(JSON.stringify({ code: 'INTERNAL_ERROR' }), { status: 500 })],
    [
      'a body that is not the contract',
      new Response(JSON.stringify({ terms: {} }), { status: 200 }),
    ],
  ])('answers null for %s', async (_label, response) => {
    fetchMock.mockResolvedValue(response);

    expect(await fetchCurrentLegal()).toBeNull();
  });

  it('answers null, and reports it, when the API cannot be reached', async () => {
    const failure = new TypeError('fetch failed');
    fetchMock.mockRejectedValue(failure);

    expect(await fetchCurrentLegal()).toBeNull();
    expect(report).toHaveBeenCalledWith(failure, { where: 'legal pages' });
  });
});
