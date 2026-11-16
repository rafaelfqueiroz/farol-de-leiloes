import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import AuthCallbackPage from './page';

// SPEC-001 BR-001-20: the landing of the Google sign-in. The backend redirects here with a one-time
// `?code=`, never a session; the page trades it through the BFF, stores the session it gets, loads
// the account and goes home, or goes back to the login (with the error code) when it cannot.
const env = vi.hoisted(() => ({
  push: vi.fn(),
  loadUser: vi.fn(),
  report: vi.fn(),
  fetch: vi.fn(),
  search: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: env.push }),
  useSearchParams: () => new URLSearchParams(env.search),
}));
vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => ({ loadUser: env.loadUser }) }));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));

beforeEach(() => {
  window.localStorage.clear();
  env.push.mockReset();
  env.loadUser.mockReset().mockResolvedValue(undefined);
  env.report.mockReset();
  env.fetch.mockReset();
  vi.stubGlobal('fetch', env.fetch);
  env.search = '';
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
    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/login'));
    expect(env.fetch).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says it is authenticating', () => {
    env.search = 'code=abc';
    env.fetch.mockReturnValue(new Promise(() => undefined));
    render(<AuthCallbackPage />);

    expect(screen.getByText('Autenticando...')).toBeVisible();
  });

  it('trades the code for the session, stores the token, loads the user and goes home', async () => {
    env.search = 'code=abc123';
    env.fetch.mockResolvedValue(json({ status: 'signed_in', accessToken: 'jwt-1', user: {} }));
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/'));
    expect(env.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = env.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/google/exchange');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ code: 'abc123' }));
    expect(localStorage.getItem('token')).toBe('jwt-1');
    expect(env.loadUser).toHaveBeenCalledTimes(1);
  });

  it('BR-001-20: ignores a token in the URL; only a code is read', async () => {
    env.search = 'token=jwt-from-url';
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/login'));
    expect(localStorage.getItem('token')).toBeNull();
    expect(env.fetch).not.toHaveBeenCalled();
  });

  it('goes to the login with the error code when the code is refused, storing nothing', async () => {
    env.search = 'code=old';
    env.fetch.mockResolvedValue(json({ code: 'INVALID_GOOGLE_CODE', context: {} }, 400));
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/login?error=INVALID_GOOGLE_CODE'));
    expect(localStorage.getItem('token')).toBeNull();
    expect(env.loadUser).not.toHaveBeenCalled();
  });

  it('BR-001-09: a first Google sign-in (terms_required) stores nothing and ends on the login until the terms screen exists', async () => {
    env.search = 'code=new-person';
    env.fetch.mockResolvedValue(
      json({ status: 'terms_required', email: 'ana@example.test', name: 'Ana' }),
    );
    render(<AuthCallbackPage />);

    await waitFor(() =>
      expect(env.push).toHaveBeenCalledWith('/login?error=GOOGLE_SIGN_IN_FAILED'),
    );
    expect(localStorage.getItem('token')).toBeNull();
    expect(env.loadUser).not.toHaveBeenCalled();
  });

  it('reports the failure and goes to the login when the exchange cannot be reached', async () => {
    env.search = 'code=abc';
    const failure = new TypeError('Failed to fetch');
    env.fetch.mockRejectedValue(failure);
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/login'));
    expect(env.report).toHaveBeenCalledWith(failure, { where: 'auth/callback' });
  });

  it('reports the failure and goes to the login when the account cannot be loaded', async () => {
    env.search = 'code=abc';
    env.fetch.mockResolvedValue(json({ status: 'signed_in', accessToken: 'jwt-1', user: {} }));
    const failure = new Error('boom');
    env.loadUser.mockRejectedValue(failure);
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/login'));
    expect(env.report).toHaveBeenCalledWith(failure, { where: 'auth/callback' });
    expect(env.push).not.toHaveBeenCalledWith('/');
  });
});
