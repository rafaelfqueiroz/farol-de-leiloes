// SPEC-003 BR-003-09: the API latency check measures the filtered search on the backend and on
// the web app's BFF route with the same rotating filters.
import { describe, expect, it } from 'vitest';
import { targets } from './api-latency.mjs';

describe('api-latency targets', () => {
  it('asks the backend and the BFF the same filtered search, on the stack ports by default', () => {
    const [backend, web] = targets({});
    expect(backend?.url(0)).toBe('http://localhost:38100/api/auctions?pageSize=10&state=SP');
    expect(web?.url(0)).toBe('http://localhost:38101/api/search?pageSize=10&state=SP');
    expect(backend?.url(3)).toContain('state=MG&modality=ONLINE_SALES');
  });

  it('rotates over filters, with state, city, modality, price and paging among them', () => {
    const [backend] = targets({});
    const urls = Array.from({ length: 12 }, (_, i) => backend?.url(i) ?? '');
    expect(new Set(urls).size).toBe(12);
    expect(urls.some((url) => url.includes('city='))).toBe(true);
    expect(urls.some((url) => url.includes('minPrice='))).toBe(true);
    expect(urls.some((url) => url.includes('page=2'))).toBe(true);
    expect(backend?.url(12)).toBe(backend?.url(0));
  });

  it('follows the port and URL variables', () => {
    const [backend, web] = targets({ E2E_API_PORT: '1', PERF_WEB_ORIGIN: 'http://web:3001' });
    expect(backend?.url(0)).toMatch(/^http:\/\/localhost:1\/api\/auctions\?/);
    expect(web?.url(0)).toMatch(/^http:\/\/web:3001\/api\/search\?/);
  });
});
