import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders as render } from '@/test/render';
import PlansCancelPage from './cancel/page';
import PlansSuccessPage from './success/page';

// SPEC-012: where Stripe sends the browser back to after the checkout.
const env = vi.hoisted(() => {
  const push = vi.fn();
  // Next's router and the context's refreshUser are stable; the success page's effect depends on both
  return { push, router: { push }, refreshUser: vi.fn() };
});

vi.mock('next/navigation', () => ({ useRouter: () => env.router }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ refreshUser: env.refreshUser }),
}));

beforeEach(() => {
  env.push.mockReset();
  env.refreshUser.mockReset();
  env.refreshUser.mockResolvedValue(undefined);
});

afterEach(() => vi.useRealTimers());

describe('PlansSuccessPage', () => {
  it('confirms the subscription and has no accessibility violations', async () => {
    const { container } = render(<PlansSuccessPage />);

    expect(
      screen.getByRole('heading', { name: 'Assinatura realizada com sucesso!' }),
    ).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('reloads the account so the new plan shows', () => {
    render(<PlansSuccessPage />);

    expect(env.refreshUser).toHaveBeenCalledTimes(1);
  });

  it('goes to the search at once on request', async () => {
    const user = userEvent.setup();
    render(<PlansSuccessPage />);

    await user.click(screen.getByRole('button', { name: 'Ir para a busca' }));

    expect(env.push).toHaveBeenCalledWith('/search');
  });

  it('goes to the search by itself after five seconds', () => {
    // TS-06: a fake clock, never a real wait
    vi.useFakeTimers();
    render(<PlansSuccessPage />);

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(env.push).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(env.push).toHaveBeenCalledWith('/search');
  });

  it('does not redirect once the page is left', () => {
    vi.useFakeTimers();
    const { unmount } = render(<PlansSuccessPage />);

    unmount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(env.push).not.toHaveBeenCalled();
  });
});

describe('PlansCancelPage', () => {
  it('says the payment was cancelled and has no accessibility violations', async () => {
    const { container } = render(<PlansCancelPage />);

    expect(screen.getByRole('heading', { name: 'Pagamento cancelado' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('takes the user back to the plans', async () => {
    const user = userEvent.setup();
    render(<PlansCancelPage />);

    await user.click(screen.getByRole('button', { name: 'Voltar aos planos' }));

    expect(env.push).toHaveBeenCalledWith('/plans');
  });
});
