import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders as render } from '@/test/render';
import RequireRole from './RequireRole';

const auth = vi.hoisted(() => ({
  state: { loading: false, isAuthenticated: true, role: 'free' },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth.state }));

describe('RequireRole', () => {
  it('names the feature and the plan it needs', async () => {
    auth.state = { loading: false, isAuthenticated: true, role: 'free' };
    const { container } = render(
      <RequireRole minimumRole="standard" featureName="Busca por IA">
        <p>conteúdo</p>
      </RequireRole>,
    );

    // DS-15: the full-page state is the page's one h1
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Acesso restrito' })).toBeInTheDocument();
    expect(
      screen.getByText('O recurso "Busca por IA" requer o plano Standard ou superior.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver planos' })).toHaveAttribute('href', '/plans');
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('names only the plan when there is no feature name', () => {
    auth.state = { loading: false, isAuthenticated: true, role: 'free' };
    render(
      <RequireRole minimumRole="premium">
        <p>conteúdo</p>
      </RequireRole>,
    );

    expect(screen.getByText('Esta página requer o plano Premium ou superior.')).toBeInTheDocument();
  });

  it('renders the content when the role is enough', () => {
    auth.state = { loading: false, isAuthenticated: true, role: 'premium' };
    render(
      <RequireRole minimumRole="standard">
        <p>conteúdo</p>
      </RequireRole>,
    );

    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });
});
