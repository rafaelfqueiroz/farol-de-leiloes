import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuctionDetail } from '@/lib/auction';
import { renderWithProviders } from '@/test/render';
import AuctionDetailClient from './AuctionDetailClient';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/contexts/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => ({ role: 'standard' }) }));

const auction: AuctionDetail = {
  code: 'C-1',
  title: 'Casa em Palmas',
  address: { city: 'Palmas', state: 'TO', zipcode: '77000-000' },
  appraisalPrice: '500000.00',
  updatedAt: '2026-03-10T15:00:00.000Z',
  matriculaUrl: 'https://example.test/matricula',
  editalUrl: 'https://example.test/edital',
  phases: [
    { modality: 'OPEN_BIDDING', minimumPrice: '400000.00' },
    {
      modality: 'SFI_AUCTION',
      minimumPrice: '380000.50',
      phaseDates: ['2026-03-11T15:00:00.000Z', '2026-03-18T15:00:00.000Z'],
      paymentMethods: ['FGTS', 'FINANCING'],
    },
  ],
};

describe('AuctionDetailClient', () => {
  it('names the amounts and phases with the Caixa vocabulary, in Brasília time (DS-28, DS-29)', () => {
    renderWithProviders(<AuctionDetailClient auction={auction} />);

    expect(screen.getByText('Valor de avaliação')).toBeInTheDocument();
    expect(screen.getByText('R$ 500.000,00')).toBeInTheDocument();
    expect(screen.getByText('Lance mínimo atual')).toBeInTheDocument();
    expect(screen.getByText('24,0% de desconto')).toBeInTheDocument();
    expect(screen.getByText('Datas do leilão')).toBeInTheDocument();
    expect(screen.getByText(/1º leilão:/)).toHaveTextContent('1º leilão: 11/03/2026 12:00');
    expect(screen.getByText('Matrícula do imóvel')).toBeInTheDocument();
    expect(screen.getByText('Edital e anexos')).toBeInTheDocument();
    expect(screen.getByText('2 fases registradas')).toBeInTheDocument();
    expect(screen.getByText(/Última atualização:/)).toHaveTextContent(
      'Última atualização: 10/03/2026 12:00',
    );

    const table = screen.getByRole('table');
    expect(within(table).getByText('Licitação Aberta')).toBeInTheDocument();
    expect(within(table).getByText('Leilão SFI')).toBeInTheDocument();
    expect(within(table).getByText('Não informado')).toBeInTheDocument();
    expect(within(table).getByText('Financiamento')).toBeInTheDocument();
  });
});
