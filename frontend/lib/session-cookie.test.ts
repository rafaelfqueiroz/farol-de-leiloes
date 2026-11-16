// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLAIN_SESSION_COOKIE,
  SECURE_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  clearSessionCookie,
  sessionCookieName,
  sessionTokenOf,
  setSessionCookie,
} from './session-cookie';

// SC-02, BR-001-18: the session token lives only in an httpOnly, SameSite=Lax cookie.
afterEach(() => {
  vi.unstubAllEnvs();
});

const setCookieOf = (mutate: (response: NextResponse) => void): string[] => {
  const response = NextResponse.json({});
  mutate(response);
  return response.headers.getSetCookie();
};

const requestWith = (cookie?: string) =>
  new NextRequest('http://localhost:3001/api/auth/me', cookie ? { headers: { cookie } } : {});

describe('the session cookie name', () => {
  it('is __Host- prefixed in production, where it is Secure', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionCookieName()).toBe('__Host-farol_session');
  });

  it('is plain outside production: a __Host- cookie cannot be set over plain http', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(sessionCookieName()).toBe('farol_session');
    vi.stubEnv('NODE_ENV', 'test');
    expect(sessionCookieName()).toBe('farol_session');
  });
});

describe('setSessionCookie', () => {
  it('sets an httpOnly, SameSite=Lax, Path=/ cookie that lasts 7 days (BR-001-18)', () => {
    vi.stubEnv('NODE_ENV', 'development');

    const [cookie] = setCookieOf((response) => setSessionCookie(response, 'jwt-1'));

    expect(SESSION_MAX_AGE_SECONDS).toBe(604800);
    expect(cookie).toContain('farol_session=jwt-1');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/Max-Age=604800/i);
  });

  it('is not Secure over plain http outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const [cookie] = setCookieOf((response) => setSessionCookie(response, 'jwt-1'));
    expect(cookie).not.toMatch(/Secure/i);
  });

  it('is Secure, __Host- prefixed, host-only (no Domain) in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const [cookie] = setCookieOf((response) => setSessionCookie(response, 'jwt-1'));

    expect(cookie).toContain('__Host-farol_session=jwt-1');
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).not.toMatch(/Domain=/i);
  });
});

describe('clearSessionCookie', () => {
  it('expires the cookie at once, with the attributes it was set with', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const cookies = setCookieOf(clearSessionCookie);

    const host = cookies.find((cookie) => cookie.startsWith(`${SECURE_SESSION_COOKIE}=`));
    expect(host).toMatch(/Max-Age=0/i);
    expect(host).toMatch(/Secure/i);
    expect(host).toMatch(/HttpOnly/i);
    expect(host).toMatch(/Path=\//i);
  });

  it('clears the plain name in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const cookies = setCookieOf(clearSessionCookie);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain(`${PLAIN_SESSION_COOKIE}=;`);
    expect(cookies[0]).toMatch(/Max-Age=0/i);
  });
});

describe('sessionTokenOf', () => {
  it('reads the cookie, or null when there is none', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(sessionTokenOf(requestWith(`${PLAIN_SESSION_COOKIE}=jwt-1; other=x`))).toBe('jwt-1');
    expect(sessionTokenOf(requestWith('other=x'))).toBeNull();
    expect(sessionTokenOf(requestWith())).toBeNull();
    expect(sessionTokenOf(requestWith(`${PLAIN_SESSION_COOKIE}=`))).toBeNull();
  });

  it('reads either name outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(sessionTokenOf(requestWith(`${SECURE_SESSION_COOKIE}=jwt-2`))).toBe('jwt-2');
  });

  it('reads only the __Host- name in production: a plain one may have been planted by a subdomain', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionTokenOf(requestWith(`${SECURE_SESSION_COOKIE}=jwt-3`))).toBe('jwt-3');
    expect(sessionTokenOf(requestWith(`${PLAIN_SESSION_COOKIE}=planted`))).toBeNull();
  });
});
