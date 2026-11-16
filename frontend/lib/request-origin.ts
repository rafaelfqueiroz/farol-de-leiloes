// Server-only (route handlers). SC-02: state-changing requests rely on SameSite=Lax plus an Origin
// check, so a cross-site form or script cannot act with the session cookie.
import type { NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Whether the request may reach a route that changes state. GET and the other read-only methods
 * are exempt (they change nothing). The rest need `Origin` to be the site's own origin
 * (`NEXT_PUBLIC_SITE_URL`, AR-42); when a browser sends no `Origin`, `Sec-Fetch-Site: same-origin`
 * stands in for it. The literal `null` origin (sandboxed frames, redirects across origins) and a
 * request with neither header are refused.
 */
export function isTrustedOrigin(request: NextRequest): boolean {
  if (!STATE_CHANGING_METHODS.has(request.method)) return true;
  const origin = request.headers.get('origin');
  if (origin !== null) return origin === new URL(publicEnv.siteUrl).origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
