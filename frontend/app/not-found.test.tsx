import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders as render } from '@/test/render';
import NotFound from './not-found';

const env = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
// The shell (top bar, navigation) has its own spec; here only the page content matters.
vi.mock('@/app/components/patterns/AppShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

beforeEach(() => env.push.mockReset());

describe('root NotFound', () => {
  it('explains that the page does not exist', async () => {
    const { container } = render(<NotFound />);

    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('takes the visitor back to the search', async () => {
    const user = userEvent.setup();
    render(<NotFound />);

    await user.click(screen.getByRole('button', { name: 'Buscar imóveis' }));

    expect(env.push).toHaveBeenCalledWith('/search');
  });
});
