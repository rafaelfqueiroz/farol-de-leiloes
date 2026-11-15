import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuctionDetail } from '@/lib/auction';
import { axe, renderWithProviders } from '@/test/render';
import AuctionDetailClient from './AuctionDetailClient';

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
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

  it('has one h1 with the title, the code as summary and the favourite action (DS-15)', async () => {
    const { container } = renderWithProviders(<AuctionDetailClient auction={auction} />);

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Casa em Palmas');
    expect(screen.getByText('Código: C-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar aos favoritos' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Informações do imóvel' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Histórico de fases' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('replaces the back arrow with breadcrumbs whose first crumb returns to the filters', async () => {
    router.push.mockClear();
    window.history.pushState({}, '', '/auction/C-1?returnUrl=%2Fsearch%3Fcity%3DPalmas');
    renderWithProviders(<AuctionDetailClient auction={auction} />);

    const nav = screen.getByRole('navigation', { name: 'Você está em' });
    expect(within(nav).getByText('Casa em Palmas')).toHaveAttribute('aria-current', 'page');

    await userEvent.click(within(nav).getByRole('link', { name: 'Buscar imóveis' }));

    expect(router.push).toHaveBeenCalledWith('/search?city=Palmas');
    window.history.pushState({}, '', '/');
  });
});
