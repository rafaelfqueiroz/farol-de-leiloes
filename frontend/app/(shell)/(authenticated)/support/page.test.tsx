import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import Support from './page';

// The support page is open to every signed-in account (free and up). The guard and the form have
// their own specs; this one proves the page puts the form behind the guard.
const env = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => env.auth }));

describe('Support page', () => {
  it('shows the support form to a free account', () => {
    env.auth = { loading: false, isAuthenticated: true, role: 'free' };
    render(<Support />);

    expect(screen.getByRole('heading', { name: 'Suporte' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Enviar solicitação' })).toBeInTheDocument();
  });

  it('shows nothing of the form while the session is read', () => {
    env.auth = { loading: true, isAuthenticated: false, role: 'free' };
    render(<Support />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Suporte' })).not.toBeInTheDocument();
  });
});
