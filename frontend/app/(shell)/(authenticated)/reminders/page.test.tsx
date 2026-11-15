import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import Reminders from './page';

// SPEC-007: reminders are a Standard feature. The list has its own spec (RemindersPage.test.tsx);
// this one proves the page puts it behind the plan check, naming the feature.
const env = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => env.auth }));
vi.mock('@/app/components/RemindersPage', () => ({
  default: () => <p>lista de lembretes</p>,
}));

describe('Reminders page', () => {
  it('shows the list to a Standard account', () => {
    env.auth = { loading: false, isAuthenticated: true, role: 'standard' };
    render(<Reminders />);

    expect(screen.getByText('lista de lembretes')).toBeVisible();
  });

  it('tells a free account which plan the feature needs', () => {
    env.auth = { loading: false, isAuthenticated: true, role: 'free' };
    render(<Reminders />);

    expect(screen.getByText('Acesso restrito')).toBeVisible();
    expect(
      screen.getByText('O recurso "Lembretes" requer o plano Standard ou superior.'),
    ).toBeVisible();
    expect(screen.queryByText('lista de lembretes')).not.toBeInTheDocument();
  });
});
