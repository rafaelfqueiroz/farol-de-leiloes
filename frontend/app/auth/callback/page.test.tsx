import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import AuthCallbackPage from './page';

// SPEC-001 BR-001-20: the landing of the Google sign-in. The backend redirects here with a one-time
// `?code=`, never a session; the page trades it through the BFF, the BFF keeps the session in a cookie, loads
// the account and goes home, or goes back to the login (with the error code) when it cannot.
const env = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  loadUser: vi.fn(),
  report: vi.fn(),
  fetch: vi.fn(),
  search: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: env.push, replace: env.replace }),
  useSearchParams: () => new URLSearchParams(env.search),
}));
vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => ({ loadUser: env.loadUser }) }));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));

beforeEach(() => {
  env.push.mockReset();
  env.replace.mockReset();
  env.loadUser.mockReset().mockResolvedValue(undefined);
  env.report.mockReset();
  env.fetch.mockReset();
  vi.stubGlobal('fetch', env.fetch);
  env.search = '';
  window.history.replaceState(null, '', '/auth/callback');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('AuthCallbackPage', () => {
  it('shows a spinner with a hidden h1 and sends a visitor without code to the sign-in', async () => {
    const { container } = render(<AuthCallbackPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: messages.authCallback.authenticating }),
    ).toBeInTheDocument();
    await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/login'));
    expect(env.fetch).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says it is authenticating', () => {
    env.search = 'code=abc';
    env.fetch.mockReturnValue(new Promise(() => undefined));
    render(<AuthCallbackPage />);

    expect(screen.getByText('Autenticando...')).toBeVisible();
  });

  it('trades the code for the session (a cookie the BFF sets), loads the user and goes home', async () => {
    env.search = 'code=abc123';
    env.fetch.mockResolvedValue(json({ status: 'signed_in', user: {} }));
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/'));
    expect(env.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = env.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/google/exchange');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ code: 'abc123' }));
    // SC-02: the answer carries no token and the page keeps none anywhere
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(init.credentials).toBe('same-origin');
    expect(env.loadUser).toHaveBeenCalledTimes(1);
  });

  it('BR-001-20: ignores a token in the URL; only a code is read', async () => {
    env.search = 'token=jwt-from-url';
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/login'));
    expect(window.localStorage.length).toBe(0);
    expect(env.fetch).not.toHaveBeenCalled();
  });

  it('goes to the login with the error code when the code is refused, storing nothing', async () => {
    env.search = 'code=old';
    env.fetch.mockResolvedValue(json({ code: 'INVALID_GOOGLE_CODE', context: {} }, 400));
    render(<AuthCallbackPage />);

    await waitFor(() =>
      expect(env.replace).toHaveBeenCalledWith('/login?error=INVALID_GOOGLE_CODE'),
    );
    expect(window.localStorage.length).toBe(0);
    expect(env.loadUser).not.toHaveBeenCalled();
  });

  it('BR-001-09, BR-010-01: a first Google sign-in (terms_required) cancels the waiting profile, stores nothing and ends on the login until the terms screen exists', async () => {
    env.search = 'code=new-person';
    env.fetch.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/auth/google/exchange'
          ? json({ status: 'terms_required', email: 'ana@example.test', name: 'Ana' })
          : json({}),
      ),
    );
    render(<AuthCallbackPage />);

    await waitFor(() =>
      expect(env.replace).toHaveBeenCalledWith('/login?error=GOOGLE_SIGN_IN_FAILED'),
    );
    const calls = env.fetch.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      '/api/auth/google/exchange',
      '/api/auth/google/cancel',
    ]);
    expect(calls[1]?.[1].method).toBe('POST');
    expect(calls[1]?.[1].body).toBe(JSON.stringify({ code: 'new-person' }));
    expect(window.localStorage.length).toBe(0);
    expect(env.loadUser).not.toHaveBeenCalled();
    expect(env.push).not.toHaveBeenCalled();
  });

  it('still ends on the login, reporting it, when the cancel cannot be reached', async () => {
    env.search = 'code=new-person';
    const failure = new TypeError('Failed to fetch');
    env.fetch
      .mockResolvedValueOnce(json({ status: 'terms_required', email: 'a@example.test', name: 'A' }))
      .mockRejectedValueOnce(failure);
    render(<AuthCallbackPage />);

    await waitFor(() =>
      expect(env.replace).toHaveBeenCalledWith('/login?error=GOOGLE_SIGN_IN_FAILED'),
    );
    expect(env.report).toHaveBeenCalledWith(failure, { where: 'auth/callback' });
  });

  it('removes the code from the address bar as soon as it is read, before the exchange answers', async () => {
    window.history.replaceState(null, '', '/auth/callback?code=abc123');
    env.search = 'code=abc123';
    env.fetch.mockReturnValue(new Promise(() => undefined));
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.fetch).toHaveBeenCalledTimes(1));
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/auth/callback');
  });

  it('never pushes a history entry: every redirect replaces the callback', async () => {
    env.search = 'code=abc123';
    env.fetch.mockResolvedValue(json({ status: 'signed_in', user: {} }));
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/'));
    expect(env.push).not.toHaveBeenCalled();
  });

  it('reports the failure and goes to the login when the exchange cannot be reached', async () => {
    env.search = 'code=abc';
    const failure = new TypeError('Failed to fetch');
    env.fetch.mockRejectedValue(failure);
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/login'));
    expect(env.report).toHaveBeenCalledWith(failure, { where: 'auth/callback' });
  });

  it('reports the failure and goes to the login when the account cannot be loaded', async () => {
    env.search = 'code=abc';
    env.fetch.mockResolvedValue(json({ status: 'signed_in', user: {} }));
    const failure = new Error('boom');
    env.loadUser.mockRejectedValue(failure);
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/login'));
    expect(env.report).toHaveBeenCalledWith(failure, { where: 'auth/callback' });
    expect(env.replace).not.toHaveBeenCalledWith('/');
  });
});
