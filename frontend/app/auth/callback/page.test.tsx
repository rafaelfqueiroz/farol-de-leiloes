import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import AuthCallbackPage from './page';

// SPEC-001: the landing of the Google sign-in. The backend redirects here with `?token=`; the page
// stores it, loads the account and goes home, or back to the login when it has no token.
const env = vi.hoisted(() => ({
  push: vi.fn(),
  loadUser: vi.fn(),
  report: vi.fn(),
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
  env.search = '';
});

describe('AuthCallbackPage', () => {
  it('shows a spinner with a hidden h1 and sends a visitor without token to the sign-in', async () => {
    const { container } = render(<AuthCallbackPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: messages.authCallback.authenticating }),
    ).toBeInTheDocument();
    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/login'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('stores the token, loads the user and goes home', async () => {
    env.search = 'token=jwt-1';
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/'));
    expect(localStorage.getItem('token')).toBe('jwt-1');
    expect(env.loadUser).toHaveBeenCalledTimes(1);
  });

  it('says it is authenticating', () => {
    env.search = 'token=jwt-1';
    env.loadUser.mockReturnValue(new Promise(() => undefined));
    render(<AuthCallbackPage />);

    expect(screen.getByText('Autenticando...')).toBeVisible();
  });

  it('stores the token, loads the account and goes home', async () => {
    env.search = 'token=jwt-1';
    env.loadUser.mockResolvedValue(undefined);
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/'));
    expect(window.localStorage.getItem('token')).toBe('jwt-1');
    expect(env.loadUser).toHaveBeenCalledTimes(1);
  });

  it('reports the failure and goes to the login when the account cannot be loaded', async () => {
    env.search = 'token=jwt-1';
    const failure = new Error('boom');
    env.loadUser.mockRejectedValue(failure);
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/login'));
    expect(env.report).toHaveBeenCalledWith(failure, { where: 'auth/callback' });
    expect(env.push).not.toHaveBeenCalledWith('/');
  });

  it('goes to the login, storing nothing, when there is no token', async () => {
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/login'));
    expect(window.localStorage.getItem('token')).toBeNull();
    expect(env.loadUser).not.toHaveBeenCalled();
  });
});
