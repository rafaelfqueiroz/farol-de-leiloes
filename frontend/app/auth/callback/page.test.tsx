import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import AuthCallbackPage from './page';

const env = vi.hoisted(() => ({ push: vi.fn(), loadUser: vi.fn(), token: null as string | null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: env.push }),
  useSearchParams: () => ({ get: () => env.token }),
}));
vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => ({ loadUser: env.loadUser }) }));

beforeEach(() => {
  env.push.mockReset();
  env.loadUser.mockReset().mockResolvedValue(undefined);
  env.token = null;
  localStorage.clear();
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
    env.token = 'jwt-1';
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/'));
    expect(localStorage.getItem('token')).toBe('jwt-1');
    expect(env.loadUser).toHaveBeenCalledTimes(1);
  });
});
