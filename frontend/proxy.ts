import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { cspHeaderName } from '@/lib/env';
import { contentSecurityPolicy } from '@/lib/security-headers';

export function proxy(request: NextRequest): NextResponse {
  // SC-17: overwrite untrusted inbound headers before Next extracts the script nonce.
  const nonce = randomBytes(16).toString('base64');
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  requestHeaders.delete('Content-Security-Policy-Report-Only');

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(cspHeaderName, policy);
  // SC-17: Next marks dynamic HTML/404s no-store. Preserve its asset and metadata
  // caching instead of setting a cache header before the response type is known.
  return response;
}

export const config = {
  // A missing API/asset URL can render the HTML 404; no path prefix is trusted
  // to identify the response type or to bypass nonce-header sanitization (SC-17).
  matcher: ['/:path*'],
};
