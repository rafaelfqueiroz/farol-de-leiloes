import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import NotFound from './not-found';

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
// The shell (top bar, navigation) has its own spec; here it only has to frame the state.
vi.mock('@/app/components/patterns/AppShell', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

beforeEach(() => router.push.mockReset());

describe('root NotFound', () => {
  it('is a centred state whose title is the only h1, with a way back to the search', async () => {
    const { container } = renderWithProviders(<NotFound />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Página não encontrada' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('O conteúdo que você procura não existe ou não está mais disponível.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Buscar imóveis' }));
    expect(router.push).toHaveBeenCalledWith('/search');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('explains that the page does not exist', async () => {
    const { container } = renderWithProviders(<NotFound />);

    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('takes the visitor back to the search', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotFound />);

    await user.click(screen.getByRole('button', { name: 'Buscar imóveis' }));

    expect(router.push).toHaveBeenCalledWith('/search');
  });
});
