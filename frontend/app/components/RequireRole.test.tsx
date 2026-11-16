import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders as render } from '@/test/render';
import RequireRole, { hasMinimumPlan, planTierOf } from './RequireRole';

const auth = vi.hoisted(() => {
  const push = vi.fn();
  return {
    push,
    // Next's router is a stable object; the guard's effect depends on it
    router: { push },
    state: { loading: false, isAuthenticated: true, role: 'free' },
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => auth.router }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth.state }));

beforeEach(() => auth.push.mockReset());

describe('RequireRole access', () => {
  it('shows a spinner, not the content nor a redirect, while the session is read', () => {
    auth.state = { loading: true, isAuthenticated: false, role: 'free' };
    render(
      <RequireRole minimumPlan="free">
        <p>conteúdo</p>
      </RequireRole>,
    );

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
    expect(auth.push).not.toHaveBeenCalled();
  });

  it('sends a visitor to the login and shows no content', () => {
    auth.state = { loading: false, isAuthenticated: false, role: 'free' };
    render(
      <RequireRole minimumPlan="free">
        <p>conteúdo</p>
      </RequireRole>,
    );

    expect(auth.push).toHaveBeenCalledWith('/login');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
  });

  it.each([
    ['free', 'free', true],
    ['free', 'standard', false],
    ['standard', 'standard', true],
    ['standard', 'premium', false],
    ['premium', 'standard', true],
    ['premium', 'premium', true],
    // SPEC-002 BR-002-23: the legacy role 'admin' is no plan
    ['admin', 'free', true],
    ['admin', 'standard', false],
    ['admin', 'premium', false],
  ] as const)('a %s account reaching a %s page: content shown is %s', (role, minimum, shown) => {
    auth.state = { loading: false, isAuthenticated: true, role };
    render(
      <RequireRole minimumPlan={minimum}>
        <p>conteúdo</p>
      </RequireRole>,
    );

    if (shown) {
      expect(screen.getByText('conteúdo')).toBeInTheDocument();
    } else {
      expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Ver planos' })).toBeInTheDocument();
    }
  });
});

describe('hasMinimumPlan', () => {
  it.each([
    ['free', 'free', true],
    ['free', 'standard', false],
    ['standard', 'free', true],
    ['standard', 'premium', false],
    ['premium', 'standard', true],
    ['admin', 'free', true],
    ['admin', 'standard', false],
  ] as const)('%s against %s is %s', (role, minimum, expected) => {
    expect(hasMinimumPlan(role, minimum)).toBe(expected);
  });

  it('treats an empty role as free', () => {
    expect(hasMinimumPlan('', 'free')).toBe(true);
    expect(hasMinimumPlan('', 'standard')).toBe(false);
  });
});

describe('planTierOf (SPEC-002 BR-002-23)', () => {
  it.each([
    ['free', 'free'],
    ['standard', 'standard'],
    ['premium', 'premium'],
    ['admin', 'free'],
    ['', 'free'],
    ['unknown', 'free'],
  ] as const)('reads the role %j as the %s tier', (role, tier) => {
    expect(planTierOf(role)).toBe(tier);
  });
});

describe('RequireRole', () => {
  it('names the feature and the plan it needs', async () => {
    auth.state = { loading: false, isAuthenticated: true, role: 'free' };
    const { container } = render(
      <RequireRole minimumPlan="standard" featureName="Busca por IA">
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
      <RequireRole minimumPlan="premium">
        <p>conteúdo</p>
      </RequireRole>,
    );

    expect(screen.getByText('Esta página requer o plano Premium ou superior.')).toBeInTheDocument();
  });

  it('renders the content when the role is enough', () => {
    auth.state = { loading: false, isAuthenticated: true, role: 'premium' };
    render(
      <RequireRole minimumPlan="standard">
        <p>conteúdo</p>
      </RequireRole>,
    );

    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });
});
