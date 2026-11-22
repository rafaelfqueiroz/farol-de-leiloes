import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onSessionEnded } from '@/lib/api-client';
import { AuthProvider, useAuth } from './AuthContext';

// BR-001-18, SC-02: the BFF cannot tell which session a slow answer belongs to, and neither can
// the browser by looking at the answer alone. An answer to a request that started under an older
// session (or none) is stale: it must not sign the newer user out and must not replace the user.
vi.mock('@/lib/report-client-error', () => ({ reportClientError: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

const meBody = (userId: string) => ({
  userId,
  email: `${userId}@b.com`,
  name: userId,
  providers: ['local'],
  role: 'free',
  emailVerified: false,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const unauthenticated = () => json({ code: 'UNAUTHENTICATED', context: {} }, 401);

/** A fetch answer the test releases by hand. */
function held() {
  let release!: (response: Response) => void;
  const answer = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}

/** Routes fetch by URL; a URL given a `held()` answer waits until the test releases it. */
function stubApi(routes: Record<string, () => Response | Promise<Response>>) {
  const fetchMock = vi.fn(async (url: string) => {
    const route = routes[url];
    if (!route) throw new Error(`unexpected request ${url}`);
    return route();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * A route whose first answer is `first` and every later one `then()`: the sign-in now asks
 * /api/auth/me once for the capabilities, and that call is not the one the test holds.
 */
function firstThen(first: () => Response | Promise<Response>, then: () => Response) {
  let calls = 0;
  return () => {
    calls += 1;
    return calls === 1 ? first() : then();
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('AuthProvider and answers that arrive late', () => {
  it('does not sign the new user out when a 401 of a request started before the sign-in arrives', async () => {
    const slow = held();
    stubApi({
      '/api/auth/me': () => json(meBody('u1')),
      '/api/auth/verification-status': () => slow.answer,
      '/api/auth/login': () => json({ user: { _id: 'u2', email: 'u2@b.com' } }, 201),
    });
    const ended = vi.fn();
    const unsubscribe = onSessionEnded(ended);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    // a request starts under the first session, its answer is held ...
    let late!: Promise<void>;
    act(() => {
      late = result.current.checkVerificationStatus();
    });
    // ... the user signs in as someone else ...
    await act(() => result.current.login('u2@b.com', 'secret1'));
    expect(result.current.user).toMatchObject({ _id: 'u2' });
    // ... and the old session's 401 comes back
    await act(async () => {
      slow.release(unauthenticated());
      await late;
    });

    expect(result.current.user).toMatchObject({ _id: 'u2' });
    expect(ended).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('still signs the user out on a 401 of a request started under the current session', async () => {
    const slow = held();
    stubApi({
      '/api/auth/me': () => json(meBody('u1')),
      '/api/auth/verification-status': () => slow.answer,
      '/api/auth/login': () => json({ user: { _id: 'u2', email: 'u2@b.com' } }, 201),
    });
    const ended = vi.fn();
    const unsubscribe = onSessionEnded(ended);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await act(() => result.current.login('u2@b.com', 'secret1'));

    let current!: Promise<void>;
    act(() => {
      current = result.current.checkVerificationStatus();
    });
    await act(async () => {
      slow.release(unauthenticated());
      await current;
    });

    expect(result.current.user).toBeNull();
    expect(ended).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('keeps the user who signed in while the first /api/auth/me was still in flight', async () => {
    const firstVisit = held();
    stubApi({
      '/api/auth/me': firstThen(
        () => firstVisit.answer,
        () => json(meBody('u2')),
      ),
      '/api/auth/login': () => json({ user: { _id: 'u2', email: 'u2@b.com' } }, 201),
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.loading).toBe(true);

    await act(() => result.current.login('u2@b.com', 'secret1'));
    await act(async () => {
      // the anonymous answer of the lookup that started before the sign-in
      firstVisit.release(unauthenticated());
      await firstVisit.answer;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toMatchObject({ _id: 'u2' });
  });

  it('does not let the first /api/auth/me replace the user who signed in meanwhile', async () => {
    const firstVisit = held();
    stubApi({
      '/api/auth/me': firstThen(
        () => firstVisit.answer,
        () => json(meBody('u2')),
      ),
      '/api/auth/login': () => json({ user: { _id: 'u2', email: 'u2@b.com' } }, 201),
    });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() => result.current.login('u2@b.com', 'secret1'));
    await act(async () => {
      firstVisit.release(json(meBody('u1')));
      await firstVisit.answer;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toMatchObject({ _id: 'u2' });
  });

  it('keeps the new user when a request started before a registration is answered 401 late', async () => {
    const slow = held();
    stubApi({
      '/api/auth/me': firstThen(unauthenticated, () => json(meBody('u3'))),
      '/api/auth/verification-status': () => slow.answer,
      '/api/auth/register': () => json({ user: { _id: 'u3', email: 'u3@b.com' } }, 201),
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let late!: Promise<void>;
    act(() => {
      late = result.current.checkVerificationStatus();
    });
    await act(() =>
      result.current.register('u3@b.com', 'secret1', 'U3', {
        termsVersion: '0.2',
        privacyVersion: '0.2',
        whatsappConsent: false,
      }),
    );
    await act(async () => {
      slow.release(unauthenticated());
      await late;
    });

    expect(result.current.user).toMatchObject({ _id: 'u3' });
  });

  it('ignores a /api/auth/me whose body is read only after the user signed in', async () => {
    const body = held();
    stubApi({
      // the headers came before the sign-in, the body after it
      '/api/auth/me': firstThen(
        () =>
          ({ ok: true, status: 200, json: () => body.answer.then((r) => r.json()) }) as Response,
        () => json(meBody('u2')),
      ),
      '/api/auth/login': () => json({ user: { _id: 'u2', email: 'u2@b.com' } }, 201),
    });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() => result.current.login('u2@b.com', 'secret1'));
    await act(async () => {
      body.release(json(meBody('u1')));
      await body.answer;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toMatchObject({ _id: 'u2' });
  });

  it('keeps `loading` for the newest lookup: an overtaken one neither sets the user nor ends loading', async () => {
    const first = held();
    const second = held();
    const answers = [first.answer, second.answer];
    stubApi({ '/api/auth/me': () => answers.shift() ?? Promise.reject(new Error('no answer')) });
    const { result } = renderHook(() => useAuth(), { wrapper });

    let again!: Promise<void>;
    act(() => {
      again = result.current.refreshUser();
    });
    await act(async () => {
      first.release(json(meBody('u1')));
      await first.answer;
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();

    await act(async () => {
      second.release(json(meBody('u2')));
      await again;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.user).toMatchObject({ _id: 'u2' });
  });
});
