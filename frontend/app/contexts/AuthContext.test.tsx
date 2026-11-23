import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import { AuthProvider, useAuth } from './AuthContext';

// AR-38: a failed login, registration or resend rejects with the ApiError of the answer, so the
// page can show errors.<CODE> (AR-39).
vi.mock('@/lib/report-client-error', () => ({ reportClientError: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

function answerWith(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => vi.unstubAllGlobals());

async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('AuthProvider', () => {
  it('rejects a failed login with the code the API answered with', async () => {
    answerWith(401, { code: 'INVALID_CREDENTIALS', context: {} });
    const { result } = renderHook(() => useAuth(), { wrapper });

    const error = await act(() => rejectionOf(result.current.login('a@b.com', 'x')));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    expect(result.current.user).toBeNull();
  });

  it('rejects a failed registration with the code the API answered with', async () => {
    answerWith(409, { code: 'EMAIL_ALREADY_REGISTERED', context: {} });
    const { result } = renderHook(() => useAuth(), { wrapper });

    const error = await act(() =>
      rejectionOf(
        result.current.register('a@b.com', 'x', 'A', {
          termsVersion: '0.2',
          privacyVersion: '0.2',
          whatsappConsent: false,
        }),
      ),
    );

    expect(error).toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED', status: 409 });
  });

  it('rejects UNKNOWN when the answer is not an API error body', async () => {
    answerWith(500, 'Internal Server Error');
    const { result } = renderHook(() => useAuth(), { wrapper });

    const error = await act(() => rejectionOf(result.current.login('a@b.com', 'x')));

    expect(error).toMatchObject({ code: 'UNKNOWN', status: 500 });
  });

  it('rejects UNAUTHENTICATED when the API says nobody is signed in on a resend', async () => {
    answerWith(401, { code: 'UNAUTHENTICATED', context: {} });
    const { result } = renderHook(() => useAuth(), { wrapper });

    const error = await act(() => rejectionOf(result.current.resendVerificationEmail()));

    expect(error).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('keeps the user from the sign-in answer and stores nothing in the browser (SC-02)', async () => {
    // the BFF has already turned the backend token into a cookie: the answer carries the user only
    answerWith(200, { user: { _id: 'u1' } });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() => result.current.login('a@b.com', 'x'));

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(result.current.user).toMatchObject({ _id: 'u1' });
  });

  it('keys the user on _id when GET /auth/me answers with userId', async () => {
    answerWith(200, { userId: 'u1', email: 'a@b.com', name: 'A', providers: [], role: 'free' });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.user).not.toBeNull());

    expect(result.current.user).toMatchObject({ _id: 'u1', email: 'a@b.com' });
    expect(result.current.user).not.toHaveProperty('userId');
  });

  // Issue #75: hasSubscription comes from the subscriptionStatus GET /auth/me returns.
  it.each([
    ['active', true],
    ['canceled', false],
    ['past_due', false],
    [null, false],
  ])('hasSubscription for /auth/me subscriptionStatus %s is %s', async (status, expected) => {
    answerWith(200, {
      userId: 'u1',
      email: 'a@b.com',
      name: 'A',
      providers: [],
      role: 'free',
      subscriptionStatus: status,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.user).not.toBeNull());

    expect(result.current.hasSubscription).toBe(expected);
  });

  // SPEC-002: capability flags for the interface (AR-51: the server still checks every request).
  it('takes isAdmin and the personas from GET /auth/me', async () => {
    answerWith(200, {
      userId: 'u1',
      email: 'a@b.com',
      name: 'A',
      providers: [],
      role: 'admin',
      isAdmin: true,
      personas: ['searcher'],
    });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.user).not.toBeNull());

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.personas).toEqual(['searcher']);
    expect(result.current.role).toBe('admin');
  });

  it('is no admin and holds no persona when the answer says nothing about them', async () => {
    answerWith(200, { user: { _id: 'u1', role: 'free' } });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() => result.current.login('a@b.com', 'x'));

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.personas).toEqual([]);
  });

  it('takes isAdmin from the sign-in answer, so the admin entry shows without a reload', async () => {
    answerWith(200, { user: { _id: 'u1', role: 'free', isAdmin: true } });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() => result.current.login('a@b.com', 'x'));

    expect(result.current.isAdmin).toBe(true);
  });
});
