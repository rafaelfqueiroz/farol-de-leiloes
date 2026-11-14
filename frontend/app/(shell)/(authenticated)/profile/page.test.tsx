import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import ProfilePage from './page';

const env = vi.hoisted(() => ({ user: null as { name: string; email: string } | null }));

vi.mock('@/app/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: env.user,
    isAuthenticated: false,
    loading: false,
    loadUser: vi.fn(),
  }),
}));

beforeEach(() => {
  env.user = null;
});

describe('ProfilePage', () => {
  it('fills the name and e-mail of a user already signed in on the first render', () => {
    env.user = { name: 'Ana', email: 'ana@exemplo.com' };
    render(<ProfilePage />);

    expect(screen.getByLabelText(/^nome/i)).toHaveValue('Ana');
    expect(screen.getByLabelText(/e-?mail/i)).toHaveValue('ana@exemplo.com');
  });

  it('follows the user when it arrives after the first render', async () => {
    const { rerender } = render(<ProfilePage />);
    expect(screen.getByLabelText(/^nome/i)).toHaveValue('');

    env.user = { name: 'Bia', email: 'bia@exemplo.com' };
    rerender(<ProfilePage />);

    await waitFor(() => expect(screen.getByLabelText(/^nome/i)).toHaveValue('Bia'));
    expect(screen.getByLabelText(/e-?mail/i)).toHaveValue('bia@exemplo.com');
  });
});
