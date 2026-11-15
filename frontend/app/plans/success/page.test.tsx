import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import PlansSuccessPage from './page';

const env = vi.hoisted(() => ({ push: vi.fn(), refreshUser: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ refreshUser: env.refreshUser }),
}));

beforeEach(() => {
  env.push.mockReset();
  env.refreshUser.mockReset().mockResolvedValue(undefined);
});

describe('PlansSuccessPage', () => {
  it('has one h1 inside a main and refreshes the user', async () => {
    const { container } = render(<PlansSuccessPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: messages.plansResult.success.title }),
    ).toBeInTheDocument();
    expect(env.refreshUser).toHaveBeenCalledTimes(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('goes to the search from the action', async () => {
    const user = userEvent.setup();
    render(<PlansSuccessPage />);

    await user.click(screen.getByRole('button', { name: messages.plansResult.success.goToSearch }));

    expect(env.push).toHaveBeenCalledWith('/search');
  });
});
