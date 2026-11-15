import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

// The session lifecycle of AuthProvider: reading the stored token, signing out and the
// email-verification calls. The error codes of login/register/resend are in AuthContext.test.tsx.
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
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const signedInWith = (extra: Record<string, Answer> = {}) => {
  window.localStorage.setItem('token', 'jwt');
  return stubApi({ '/api/auth/me': { status: 200, body: meBody }, ...extra });
};

beforeEach(() => window.localStorage.clear());
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
  it('finishes loading signed out, without calling the API, when there is no token', async () => {
    const fetchMock = stubApi({});
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      user: null,
      isAuthenticated: false,
      emailVerified: false,
      role: 'free',
      hasSubscription: false,
    });
  });

  it('sends the stored token to /api/auth/me', async () => {
    const fetchMock = signedInWith();
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', {
      headers: { Authorization: 'Bearer jwt' },
    });
  });

  it('drops a token the API no longer accepts', async () => {
    window.localStorage.setItem('token', 'expired');
    stubApi({ '/api/auth/me': { status: 401, body: { code: 'UNAUTHENTICATED', context: {} } } });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(window.localStorage.getItem('token')).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it('drops the token and stays signed out when the API cannot be reached', async () => {
    window.localStorage.setItem('token', 'jwt');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(window.localStorage.getItem('token')).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('refreshUser reads the account again', async () => {
    const fetchMock = signedInWith();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(() => result.current.refreshUser());

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stores the token and the user after a successful registration', async () => {
    const fetchMock = stubApi({
      '/api/auth/register': { status: 201, body: { accessToken: 'new-jwt', user: { _id: 'u2' } } },
    });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() => result.current.register('a@b.com', 'secret1', 'A'));

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'secret1', name: 'A' }),
    });
    expect(window.localStorage.getItem('token')).toBe('new-jwt');
    expect(result.current.user).toMatchObject({ _id: 'u2' });
  });
});

describe('AuthProvider logout', () => {
  it('tells the API, then clears the token and the user', async () => {
    const fetchMock = signedInWith({ '/api/auth/logout': { status: 200, body: {} } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(() => result.current.logout());

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt' },
    });
    expect(window.localStorage.getItem('token')).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it('signs out locally even when the API call fails', async () => {
    signedInWith();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    // /api/auth/logout has no stubbed answer, so the stub throws like an unreachable API
    await act(() => result.current.logout());

    expect(window.localStorage.getItem('token')).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('does not call the API when there is no token', async () => {
    const fetchMock = stubApi({});
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.logout());

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AuthProvider email verification', () => {
  it('asks the API to resend the verification email with the token', async () => {
    const fetchMock = signedInWith({ '/api/auth/resend-verification': { status: 200, body: {} } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(() => result.current.resendVerificationEmail());

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/resend-verification', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt' },
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
      headers: { Authorization: 'Bearer jwt' },
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

  it('does nothing without a token', async () => {
    const fetchMock = stubApi({});
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.checkVerificationStatus());

    expect(fetchMock).not.toHaveBeenCalled();
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
