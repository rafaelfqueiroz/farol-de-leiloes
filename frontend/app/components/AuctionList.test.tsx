import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Auction } from '@/lib/auction';
import { axe, renderWithProviders } from '@/test/render';
import AuctionList from './AuctionList';

vi.mock('../contexts/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock('./AuctionCard', () => ({
  default: ({ auction }: { auction: { code: string } }) => <p>{`leilão ${auction.code}`}</p>,
}));

const auctions = (count: number): Auction[] =>
  Array.from({ length: count }, (_, i) => ({ code: `A${i}` }) as Auction);

describe('AuctionList', () => {
  it('counts the results with pt-BR grouping and says how many are shown (DS-29)', async () => {
    const { container } = renderWithProviders(<AuctionList auctions={auctions(2)} total={1250} />);

    expect(screen.getByText('1.250 resultados (mostrando 2)')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('titles the results with an h2 under the page h1 (DS-15)', () => {
    renderWithProviders(<AuctionList auctions={auctions(2)} total={2} />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Resultado da busca' }),
    ).toBeInTheDocument();
  });

  it('writes the singular for one result', () => {
    renderWithProviders(<AuctionList auctions={auctions(1)} total={1} />);

    expect(screen.getByText('1 resultado')).toBeInTheDocument();
  });

  it('shows the empty state and the loading state', () => {
    const { rerender } = renderWithProviders(<AuctionList auctions={[]} total={0} />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Nenhum leilão encontrado' }),
    ).toBeInTheDocument();

    rerender(<AuctionList auctions={[]} total={0} isLoading />);
    expect(screen.getByText('Carregando leilões…')).toBeInTheDocument();
  });
});
