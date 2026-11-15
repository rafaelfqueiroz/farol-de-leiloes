import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders as render } from '@/test/render';
import PlansPage from './page';

vi.mock('@/app/contexts/AuthContext', () => ({
  useAuth: () => ({ role: 'free', hasSubscription: false }),
}));

describe('PlansPage', () => {
  it('renders the plan prices through the Money formatter (DS-29)', () => {
    render(<PlansPage />);
    expect(screen.getByText(/^R\$\s0,00$/)).toBeInTheDocument();
    expect(screen.getByText(/^R\$\s49,90$/)).toBeInTheDocument();
    expect(screen.getByText(/^R\$\s109,90$/)).toBeInTheDocument();
  });

  it('takes the plan copy from the catalogue', () => {
    render(<PlansPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Planos' })).toBeInTheDocument();
    expect(screen.getByText('Filtros salvos (até 10)')).toBeInTheDocument();
    expect(screen.getByText('Mais popular')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assinar Standard' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Em breve' })).toBeDisabled();
    expect(screen.getAllByText('/mês')).toHaveLength(3);
  });

  it('has one h1 and the plan names as h2 (DS-15)', () => {
    render(<PlansPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Gratuito', 'Standard', 'Premium']);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('offers the coupon field below the plans while Standard is not the current plan', () => {
    render(<PlansPage />);
    expect(screen.getByPlaceholderText('Cupom de desconto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    // the AppShell owns <main> (#42), so the landmark is supplied here
    const { baseElement } = render(
      <main>
        <PlansPage />
      </main>,
    );
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
