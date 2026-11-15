import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders as render } from '@/test/render';
import ProfilePage from './page';

const env = vi.hoisted(() => ({
  user: null as { name: string; email: string; providers?: string[] } | null,
}));

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

  it('has one h1 and the cards as h2 sections (DS-15)', () => {
    env.user = { name: 'Ana', email: 'ana@exemplo.com', providers: ['local'] };
    render(<ProfilePage />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Meu Perfil' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Informações do Perfil', 'Dados Pessoais', 'Alterar Senha']);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    env.user = { name: 'Ana', email: 'ana@exemplo.com', providers: ['local'] };
    // the AppShell owns <main> (#42), so the landmark is supplied here
    const { baseElement } = render(
      <main>
        <ProfilePage />
      </main>,
    );
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
