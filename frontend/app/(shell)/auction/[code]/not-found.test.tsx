import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import AuctionNotFound from './not-found';

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));

describe('AuctionNotFound', () => {
  it('is a centred state whose title is the only h1, with a way back to the search', async () => {
    const { container } = renderWithProviders(<AuctionNotFound />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Imóvel indisponível' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Este imóvel não foi encontrado ou não está mais disponível para leilão.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Buscar imóveis' }));
    expect(router.push).toHaveBeenCalledWith('/search');
    expect(await axe(container)).toHaveNoViolations();
  });
});
