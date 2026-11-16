// Server-only (route handlers). SC-02: the session token lives only in an httpOnly, SameSite=Lax
// cookie that the BFF sets and reads; browser JavaScript never sees it. The backend authenticates
// `Authorization: Bearer` only, so the BFF turns the cookie into that header on each call.
import type { NextRequest, NextResponse } from 'next/server';
import { isProductionRuntime } from '@/lib/env';

/** BR-001-18: a session expires 7 days after sign-in, so the cookie does too. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** `__Host-` makes the browser refuse a cookie set from a subdomain or without Secure and Path=/. */
export const SECURE_SESSION_COOKIE = '__Host-farol_session';
/** A `__Host-` cookie cannot be set without Secure, so plain-http development needs this name. */
export const PLAIN_SESSION_COOKIE = 'farol_session';

/** The name the cookie is set under: `__Host-` in production (Secure), plain otherwise. */
export function sessionCookieName(): string {
  return isProductionRuntime() ? SECURE_SESSION_COOKIE : PLAIN_SESSION_COOKIE;
}

/**
 * The session token of the request, or null. Production reads only the `__Host-` name: a plain
 * `farol_session` there could have been planted by a sibling subdomain, which is exactly what the
 * prefix rules out. Development reads both names, so a cookie set either way keeps working.
 */
export function sessionTokenOf(request: NextRequest): string | null {
  const names = isProductionRuntime()
    ? [SECURE_SESSION_COOKIE]
    : [PLAIN_SESSION_COOKIE, SECURE_SESSION_COOKIE];
  for (const name of names) {
    const value = request.cookies.get(name)?.value;
    if (value) return value;
  }
  return null;
}

function attributes() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: isProductionRuntime(),
  };
}

/** Starts the browser's session: sets the cookie on the response that carries the sign-in. */
export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: sessionCookieName(),
    value: token,
    ...attributes(),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Ends the browser's session: expires every name the cookie can have been set under. */
export function clearSessionCookie(response: NextResponse): void {
  for (const name of new Set([sessionCookieName(), PLAIN_SESSION_COOKIE])) {
    response.cookies.set({ name, value: '', ...attributes(), maxAge: 0 });
  }
}
