// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { isTrustedOrigin } from './request-origin';
import { SITE_ORIGIN } from '@/test/bff-requests';

// SC-02: state-changing requests rely on SameSite plus an Origin check. The site origin is
// NEXT_PUBLIC_SITE_URL's default under test.
const request = (method: string, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost:3001/api/favorites', { method, headers });

describe('isTrustedOrigin', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('passes a %s from the site origin', (method) => {
    expect(isTrustedOrigin(request(method, { Origin: SITE_ORIGIN }))).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses a %s from another origin', (method) => {
    expect(isTrustedOrigin(request(method, { Origin: 'https://evil.example' }))).toBe(false);
  });

  it('refuses an origin that only starts like the site, or differs by scheme or port', () => {
    for (const origin of [
      `${SITE_ORIGIN}.evil.example`,
      'http://faroldosleiloes.com.br',
      `${SITE_ORIGIN}:8443`,
      'https://www.faroldosleiloes.com.br',
    ]) {
      expect(isTrustedOrigin(request('POST', { Origin: origin }))).toBe(false);
    }
  });

  it('refuses the literal null origin, even if the fetch metadata says same-origin', () => {
    expect(isTrustedOrigin(request('POST', { Origin: 'null' }))).toBe(false);
    expect(
      isTrustedOrigin(request('POST', { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' })),
    ).toBe(false);
  });

  it('refuses a request with neither Origin nor Sec-Fetch-Site', () => {
    expect(isTrustedOrigin(request('POST'))).toBe(false);
  });

  it('accepts Sec-Fetch-Site: same-origin when Origin is absent, and nothing else', () => {
    expect(isTrustedOrigin(request('POST', { 'Sec-Fetch-Site': 'same-origin' }))).toBe(true);
    for (const site of ['same-site', 'cross-site', 'none']) {
      expect(isTrustedOrigin(request('POST', { 'Sec-Fetch-Site': site }))).toBe(false);
    }
  });

  it('exempts GET, HEAD and OPTIONS: they change nothing', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isTrustedOrigin(request(method, { Origin: 'https://evil.example' }))).toBe(true);
      expect(isTrustedOrigin(request(method))).toBe(true);
    }
  });
});
