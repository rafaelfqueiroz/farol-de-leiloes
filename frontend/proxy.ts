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
  // A cached document would reuse a nonce across requests (SC-17).
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
