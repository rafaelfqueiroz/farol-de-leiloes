import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Auction } from '@/lib/auction';
import { axe, renderWithProviders } from '@/test/render';
import AuctionCard, { getCountdown } from './AuctionCard';

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

function renderCard(value: Auction, scheme: 'light' | 'dark' = 'light', now?: Date) {
  return renderWithProviders(
    <AuctionCard
      auction={value}
      isFavorite={false}
      onToggleFavorite={vi.fn()}
      detailUrl="/auction/C-1"
      showDate
      now={now}
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

    expect(screen.queryByText(/avaliação/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/lance mínimo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
  });

  it('labels the amounts with the Caixa vocabulary (DS-28)', () => {
    renderCard(auction);

    expect(screen.getByText('Valor de avaliação:')).toBeInTheDocument();
    expect(screen.getByText('Lance mínimo:')).toBeInTheDocument();
    expect(screen.getByText('Leilão SFI')).toBeInTheDocument();
  });

  it('writes the plural of the registered phases', () => {
    const phase = { modality: 'SFI_AUCTION', minimumPrice: null };
    renderCard({ ...auction, phases: [phase, phase, phase] });

    expect(screen.getByText(/3 fases registradas/)).toBeInTheDocument();
  });
});

// AR-23: the countdown counts Brasília calendar days. The vitest env runs in TZ=Asia/Tokyo, a
// zone where the same instants fall on another calendar day, so a browser-zone count would fail.
describe('getCountdown', () => {
  // 11:00 on 10 March in Brasília (14:00 UTC; 23:00 the same day in Tokyo)
  const now = new Date('2026-03-10T14:00:00.000Z');
  const phase = (...phaseDates: string[]) => ({
    modality: 'SFI_AUCTION',
    minimumPrice: null,
    phaseDates,
  });

  it('is today until midnight in Brasília, even when the browser zone is already on the next day', () => {
    // 23:59 on the 10th in Brasília, but already the 11th in Tokyo
    expect(getCountdown(phase('2026-03-11T02:59:00.000Z'), now)).toEqual({ kind: 'today' });
  });

  it('is tomorrow from midnight in Brasília', () => {
    expect(getCountdown(phase('2026-03-11T03:00:00.000Z'), now)).toEqual({ kind: 'tomorrow' });
  });

  it('counts the days after tomorrow', () => {
    expect(getCountdown(phase('2026-03-15T15:00:00.000Z'), now)).toEqual({
      kind: 'days',
      count: 5,
    });
  });

  it('counts an earlier time today as today and skips dates already past', () => {
    expect(getCountdown(phase('2026-03-10T03:00:00.000Z'), now)).toEqual({ kind: 'today' });
    expect(getCountdown(phase('2026-03-09T20:00:00.000Z'), now)).toBeNull();
  });

  it('uses the nearest upcoming date and ignores one it cannot read', () => {
    expect(
      getCountdown(
        phase('2026-03-20T15:00:00.000Z', 'not a date', '2026-03-13T15:00:00.000Z'),
        now,
      ),
    ).toEqual({ kind: 'days', count: 3 });
  });

  it('has no countdown for a direct online sale or a phase without dates', () => {
    expect(
      getCountdown({ ...phase('2026-03-12T15:00:00.000Z'), modality: 'DIRECT_ONLINE_SALES' }, now),
    ).toBeNull();
    expect(getCountdown(phase(), now)).toBeNull();
    expect(getCountdown(undefined, now)).toBeNull();
  });
});

describe('AuctionCard countdown chip', () => {
  const now = new Date('2026-03-10T14:00:00.000Z');
  const withDate = (date: string): Auction => ({
    ...auction,
    phases: [{ modality: 'SFI_AUCTION', minimumPrice: null, phaseDates: [date] }],
  });

  it.each([
    ['2026-03-11T02:59:00.000Z', 'Hoje'],
    ['2026-03-11T03:00:00.000Z', 'Amanhã'],
    ['2026-03-15T15:00:00.000Z', '5 dias'],
  ])('shows %s as "%s"', (date, text) => {
    renderCard(withDate(date), 'light', now);

    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
