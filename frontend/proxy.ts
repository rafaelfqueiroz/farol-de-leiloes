import { NextResponse } from 'next/server';

// The token lives in localStorage, so the server cannot tell whether a request is authenticated:
// each page redirects to /login (or home) on its own. This proxy only exists for future
// enhancements, such as route protection once the session moves to a cookie.
export function proxy() {
  return NextResponse.next();
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
