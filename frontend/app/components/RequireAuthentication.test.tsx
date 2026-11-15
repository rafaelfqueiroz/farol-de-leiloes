import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import RequireAuthentication from './RequireAuthentication';

// #42: the one guard of the signed-in pages. A visitor is sent to the login and never sees the page.
const env = vi.hoisted(() => {
  const push = vi.fn();
  // Next's router is a stable object; the guard's effect depends on it
  return { push, router: { push }, auth: {} as Record<string, unknown> };
});

vi.mock('next/navigation', () => ({ useRouter: () => env.router }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => env.auth }));

beforeEach(() => env.push.mockReset());

const renderGuard = () =>
  render(
    <RequireAuthentication>
      <p>conteúdo</p>
    </RequireAuthentication>,
  );

describe('RequireAuthentication', () => {
  it('shows a spinner, and does not redirect yet, while the session is read', () => {
    env.auth = { loading: true, isAuthenticated: false };
    renderGuard();

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
    expect(env.push).not.toHaveBeenCalled();
  });

  it('sends a visitor to the login and shows none of the page', () => {
    env.auth = { loading: false, isAuthenticated: false };
    renderGuard();

    expect(env.push).toHaveBeenCalledWith('/login');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
  });

  it('shows the page to a signed-in user', () => {
    env.auth = { loading: false, isAuthenticated: true };
    renderGuard();

    expect(screen.getByText('conteúdo')).toBeInTheDocument();
    expect(env.push).not.toHaveBeenCalled();
  });
});
