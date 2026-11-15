import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import NotFound from './not-found';

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
// the shell has its own tests; here it only has to frame the state
vi.mock('@/app/components/patterns/AppShell', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

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
});
