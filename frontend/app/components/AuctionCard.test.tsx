import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Auction } from '@/lib/auction';
import { axe, renderWithProviders } from '@/test/render';
import AuctionCard from './AuctionCard';

// The reminder dialog has its own test and needs the auth and reminders providers.
vi.mock('./ReminderButton', () => ({ default: () => null }));

const auction: Auction = {
  code: 'C-1',
  title: 'Casa em Palmas',
  address: { city: 'Palmas', state: 'TO' },
  appraisalPrice: '500000.00',
  phases: [
    {
      modality: 'SFI_AUCTION',
      minimumPrice: '380000.50',
      date: '2026-03-11T02:59:00.000Z',
    },
  ],
};

function renderCard(value: Auction, scheme: 'light' | 'dark' = 'light') {
  return renderWithProviders(
    <AuctionCard
      auction={value}
      isFavorite={false}
      onToggleFavorite={vi.fn()}
      detailUrl="/auction/C-1"
      showDate
    />,
    { scheme },
  );
}

describe('AuctionCard', () => {
  it.each(['light', 'dark'] as const)(
    'formats the money strings and the Brasília date, and passes axe (%s)',
    async (scheme) => {
      const { container } = renderCard(auction, scheme);

      expect(screen.getByText('R$ 500.000,00')).toBeInTheDocument();
      expect(screen.getByText('R$ 380.000,50')).toBeInTheDocument();
      // 02:59 UTC on the 11th is 23:59 on the 10th in Brasília
      expect(screen.getByText('10/03/2026')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('hides an amount Caixa did not publish instead of showing R$ 0,00', () => {
    renderCard({
      ...auction,
      appraisalPrice: null,
      phases: [{ modality: 'SFI_AUCTION', minimumPrice: null }],
    });

    expect(screen.queryByText(/Avaliação/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lance mínimo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
  });
});
