import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import RequireVerification from './RequireVerification';

// SPEC-001: an email-and-password account must confirm its address before using the app; a Google
// account is verified by Google and a visitor is not this guard's concern.
const env = vi.hoisted(() => {
  const push = vi.fn();
  // Next's router is a stable object; the guard's effect depends on it
  return { push, router: { push }, auth: {} as Record<string, unknown> };
});

vi.mock('next/navigation', () => ({
  useRouter: () => env.router,
  usePathname: () => '/search',
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => env.auth }));

beforeEach(() => env.push.mockReset());

function state(overrides: Record<string, unknown>) {
  env.auth = {
    loading: false,
    isAuthenticated: true,
    emailVerified: false,
    user: { providers: ['local'] },
    ...overrides,
  };
}

const renderGuard = () =>
  render(
    <RequireVerification>
      <p>conteúdo</p>
    </RequireVerification>,
  );

describe('RequireVerification', () => {
  it('shows a spinner, and does not redirect yet, while the session is read', () => {
    state({ loading: true });
    renderGuard();

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
    expect(env.push).not.toHaveBeenCalled();
  });

  it('sends an unverified email-and-password account to confirm its email', () => {
    state({});
    renderGuard();

    expect(env.push).toHaveBeenCalledWith('/verify-email');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
  });

  it('shows the page to a verified email-and-password account', () => {
    state({ emailVerified: true });
    renderGuard();

    expect(screen.getByText('conteúdo')).toBeInTheDocument();
    expect(env.push).not.toHaveBeenCalled();
  });

  it('shows the page to a Google account whatever its verified flag', () => {
    state({ user: { providers: ['google'] } });
    renderGuard();

    expect(screen.getByText('conteúdo')).toBeInTheDocument();
    expect(env.push).not.toHaveBeenCalled();
  });

  it('treats an account linked to both providers as verified by Google', () => {
    state({ user: { providers: ['local', 'google'] } });
    renderGuard();

    expect(screen.getByText('conteúdo')).toBeInTheDocument();
    expect(env.push).not.toHaveBeenCalled();
  });

  it('leaves a visitor alone', () => {
    state({ isAuthenticated: false, user: null });
    renderGuard();

    expect(screen.getByText('conteúdo')).toBeInTheDocument();
    expect(env.push).not.toHaveBeenCalled();
  });
});
