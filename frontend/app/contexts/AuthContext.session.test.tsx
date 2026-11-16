import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

// The session lifecycle of AuthProvider (SC-02): the session is a cookie the browser sends by
// itself, so "signed in" is whatever GET /api/auth/me answers; signing out and the
// email-verification calls follow. The error codes of login/register/resend are in AuthContext.test.tsx.
vi.mock('@/lib/report-client-error', () => ({ reportClientError: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

const meBody = {
  userId: 'u1',
  email: 'a@b.com',
  name: 'A',
  providers: ['local'],
  role: 'free',
  emailVerified: false,
};

type Answer = { status: number; body: unknown };

/** Stubs fetch with one answer per URL; a URL with no answer is a test bug and throws. */
function stubApi(answers: Record<string, Answer>) {
  const fetchMock = vi.fn(async (url: string) => {
    const answer = answers[url];
    if (!answer) throw new Error(`unexpected request ${url}`);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const signedInWith = (extra: Record<string, Answer> = {}) =>
  stubApi({ '/api/auth/me': { status: 200, body: meBody }, ...extra });

const unauthenticated: Answer = { status: 401, body: { code: 'UNAUTHENTICATED', context: {} } };

afterEach(() => vi.unstubAllGlobals());

async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('AuthProvider session', () => {
  it('finishes loading signed out when /api/auth/me says nobody is signed in', async () => {
    const fetchMock = stubApi({ '/api/auth/me': unauthenticated });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({
      user: null,
      isAuthenticated: false,
      emailVerified: false,
      role: 'free',
      hasSubscription: false,
    });
  });

  it('asks /api/auth/me with the session cookie and no Authorization header', async () => {
    const fetchMock = signedInWith();
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', { credentials: 'same-origin' });
    expect(result.current.user).toMatchObject({ _id: 'u1', email: 'a@b.com' });
  });

  it('keeps no token anywhere in the browser', async () => {
    signedInWith();
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('stays signed out when the API cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
  });

  it('signs the user out when any call learns the session ended (401 UNAUTHENTICATED)', async () => {
    stubApi({
      '/api/auth/me': { status: 200, body: meBody },
      '/api/auth/verification-status': unauthenticated,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(() => result.current.checkVerificationStatus());

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('keeps the user when the API only has a hiccup (a 500 on /api/auth/me)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(meBody), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(() => result.current.refreshUser());

    expect(result.current.isAuthenticated).toBe(true);
  });

  it('refreshUser reads the account again', async () => {
    const fetchMock = signedInWith();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(() => result.current.refreshUser());

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the user from a successful registration, with no token in the answer or the browser', async () => {
    const fetchMock = stubApi({
      '/api/auth/register': { status: 201, body: { user: { _id: 'u2' } } },
    });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() => result.current.register('a@b.com', 'secret1', 'A'));

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'a@b.com',
        password: 'secret1',
        name: 'A',
        acceptTerms: true,
      }),
    });
    expect(window.localStorage.length).toBe(0);
    expect(result.current.user).toMatchObject({ _id: 'u2' });
  });
});

describe('AuthProvider logout', () => {
  it('tells the API (the BFF clears the cookie), then clears the user', async () => {
    const fetchMock = signedInWith({ '/api/auth/logout': { status: 200, body: {} } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(() => result.current.logout());

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(result.current.user).toBeNull();
  });

  it('signs out locally even when the API call fails', async () => {
    signedInWith();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    // /api/auth/logout has no stubbed answer, so the stub throws like an unreachable API
    await act(() => result.current.logout());

    expect(result.current.isAuthenticated).toBe(false);
  });

  it('is signed out afterwards even when the session was already gone', async () => {
    stubApi({ '/api/auth/me': unauthenticated, '/api/auth/logout': { status: 204, body: null } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.logout());

    expect(result.current.user).toBeNull();
  });
});

describe('AuthProvider email verification', () => {
  it('asks the API to resend the verification email with the session cookie', async () => {
    const fetchMock = signedInWith({ '/api/auth/resend-verification': { status: 200, body: {} } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(() => result.current.resendVerificationEmail());

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/resend-verification', {
      method: 'POST',
      credentials: 'same-origin',
    });
  });

  it('rejects a refused resend with the code the API answered with', async () => {
    signedInWith({
      '/api/auth/resend-verification': {
        status: 429,
        body: { code: 'TOO_MANY_REQUESTS', context: {} },
      },
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    const error = await act(() => rejectionOf(result.current.resendVerificationEmail()));

    expect(error).toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 });
  });

  it('adopts the verified flag and providers the API reports', async () => {
    const fetchMock = signedInWith({
      '/api/auth/verification-status': {
        status: 200,
        body: { emailVerified: true, providers: ['local', 'google'] },
      },
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.emailVerified).toBe(false);

    await act(() => result.current.checkVerificationStatus());

    expect(result.current.emailVerified).toBe(true);
    expect(result.current.user?.providers).toEqual(['local', 'google']);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/verification-status', {
      credentials: 'same-origin',
    });
  });

  it('keeps the same user object when nothing changed', async () => {
    signedInWith({
      '/api/auth/verification-status': {
        status: 200,
        body: { emailVerified: false, providers: ['local'] },
      },
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    const before = result.current.user;

    await act(() => result.current.checkVerificationStatus());

    expect(result.current.user).toBe(before);
  });

  it('leaves the user as is when the API refuses the status call', async () => {
    signedInWith({ '/api/auth/verification-status': { status: 500, body: {} } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    const before = result.current.user;

    await act(() => result.current.checkVerificationStatus());

    expect(result.current.user).toBe(before);
  });
});

describe('useAuth', () => {
  it('throws outside an AuthProvider', () => {
    // React reports the throw on the console even though the test expects it
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used within an AuthProvider',
    );

    spy.mockRestore();
  });
});
