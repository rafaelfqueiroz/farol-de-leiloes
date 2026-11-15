// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import robots from './robots';
import sitemap from './sitemap';

// SPEC-005 (public pages are indexed): robots.txt keeps crawlers out of private areas and points at
// the sitemap; the sitemap lists the static pages and every auction code the API publishes.
const report = vi.hoisted(() => vi.fn());
const fetchMock = vi.fn();

vi.mock('@/lib/report-client-error', () => ({ reportClientError: report }));

const SITE = 'https://faroldosleiloes.com.br';
// TS-06: "now" is fixed, so the lastModified of the static pages is exact
const NOW = new Date('2026-03-10T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.stubEnv('BACKEND_API_URL', 'http://backend:3000');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  fetchMock.mockReset();
  report.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('robots', () => {
  it('allows the site, keeps crawlers out of private areas and names the sitemap', () => {
    expect(robots()).toEqual({
      rules: {
        userAgent: '*',
        allow: '/',
        disallow: ['/profile/', '/reminders/', '/api/'],
      },
      sitemap: `${SITE}/sitemap.xml`,
    });
  });
});

describe('sitemap', () => {
  it('lists the home and plans pages, then each auction with its last update', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          codes: [
            { code: '1444400000001', updatedAt: '2026-03-01T08:00:00.000Z' },
            { code: '1444400000002', updatedAt: '2026-03-02T09:30:00.000Z' },
          ],
        }),
        { status: 200 },
      ),
    );

    const entries = await sitemap();

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://backend:3000/api/auctions/sitemap/codes',
    );
    expect(entries).toEqual([
      { url: SITE, lastModified: NOW, changeFrequency: 'daily', priority: 1 },
      { url: `${SITE}/plans`, lastModified: NOW, changeFrequency: 'weekly', priority: 0.7 },
      {
        url: `${SITE}/auction/1444400000001`,
        lastModified: new Date('2026-03-01T08:00:00.000Z'),
        changeFrequency: 'daily',
        priority: 0.8,
      },
      {
        url: `${SITE}/auction/1444400000002`,
        lastModified: new Date('2026-03-02T09:30:00.000Z'),
        changeFrequency: 'daily',
        priority: 0.8,
      },
    ]);
  });

  it('lists only the static pages when the API answers with no codes field', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const entries = await sitemap();

    expect(entries.map((entry) => entry.url)).toEqual([SITE, `${SITE}/plans`]);
  });

  it('keeps the static pages and reports the status when the API answers an error', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));

    const entries = await sitemap();

    expect(entries.map((entry) => entry.url)).toEqual([SITE, `${SITE}/plans`]);
    expect(report).toHaveBeenCalledWith(new Error('Backend returned 503'), { where: 'sitemap' });
  });

  it('keeps the static pages and reports the failure when the API cannot be reached', async () => {
    const failure = new TypeError('fetch failed');
    fetchMock.mockRejectedValue(failure);

    const entries = await sitemap();

    expect(entries.map((entry) => entry.url)).toEqual([SITE, `${SITE}/plans`]);
    expect(report).toHaveBeenCalledWith(failure, { where: 'sitemap' });
  });
});
