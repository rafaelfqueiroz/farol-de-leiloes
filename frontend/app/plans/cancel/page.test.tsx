import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import PlansCancelPage from './page';

const env = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));

beforeEach(() => {
  env.push.mockReset();
});

describe('PlansCancelPage', () => {
  it('has one h1 inside a main', async () => {
    const { container } = render(<PlansCancelPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: messages.plansResult.cancel.title }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('goes back to the plans from the action', async () => {
    const user = userEvent.setup();
    render(<PlansCancelPage />);

    await user.click(screen.getByRole('button', { name: messages.plansResult.cancel.back }));

    expect(env.push).toHaveBeenCalledWith('/plans');
  });
});
