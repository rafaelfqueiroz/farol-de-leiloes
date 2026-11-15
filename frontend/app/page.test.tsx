import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import Home from './page';

// The home page is the landing page for visitors and a redirect for signed-in users: to /search,
// or to /verify-email for an email-and-password account that has not confirmed its address.
const env = vi.hoisted(() => ({
  push: vi.fn(),
  auth: {} as Record<string, unknown>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('./contexts/AuthContext', () => ({ useAuth: () => env.auth }));
// the landing page does not read favourites; the provider would only start its own requests
vi.mock('./contexts/FavoritesContext', () => ({
  FavoritesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function signedOut(loading = false) {
  env.auth = { loading, isAuthenticated: false, user: null, emailVerified: false };
}

function signedIn(providers: string[], emailVerified: boolean) {
  env.auth = {
    loading: false,
    isAuthenticated: true,
    user: { _id: 'u1', providers },
    emailVerified,
  };
}

beforeEach(() => env.push.mockReset());

describe('Home', () => {
  it('shows a spinner, and no landing page, while the session is read', () => {
    signedOut(true);
    render(<Home />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(env.push).not.toHaveBeenCalled();
  });

  it('shows the landing page to a visitor', () => {
    signedOut();
    render(<Home />);

    expect(screen.getByRole('heading', { level: 2, name: /^Encontre o imóvel/ })).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(env.push).not.toHaveBeenCalled();
  });

  it('sends a verified account to the search', () => {
    signedIn(['local'], true);
    render(<Home />);

    expect(env.push).toHaveBeenCalledWith('/search');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('sends a Google account to the search even without a verified flag', () => {
    signedIn(['google'], false);
    render(<Home />);

    expect(env.push).toHaveBeenCalledWith('/search');
  });

  it('sends an unverified email-and-password account to confirm its email', () => {
    signedIn(['local'], false);
    render(<Home />);

    expect(env.push).toHaveBeenCalledWith('/verify-email');
    expect(env.push).not.toHaveBeenCalledWith('/search');
  });

  it('treats an account linked to both providers as verified by Google', () => {
    signedIn(['local', 'google'], false);
    render(<Home />);

    expect(env.push).toHaveBeenCalledWith('/search');
  });
});
