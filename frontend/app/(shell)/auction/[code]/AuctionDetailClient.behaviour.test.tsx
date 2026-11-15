import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuctionDetail } from '@/lib/auction';
import { axe, renderWithProviders as render } from '@/test/render';
import AuctionDetailClient from './AuctionDetailClient';

// SPEC-005: the public property page. Money and dates are in AuctionDetailClient.test.tsx; this
// spec covers what the page offers each visitor (favourite, back, documents, the Caixa link) and
// what it shows when Caixa left a field out (BR-003-19: "Não informado", never R$ 0,00).
const env = vi.hoisted(() => ({
  push: vi.fn(),
  toggleFavorite: vi.fn(),
  favorites: [] as string[],
  role: 'standard',
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('@/app/contexts/FavoritesContext', () => ({
  useFavorites: () => ({
    isFavorite: (code: string) => env.favorites.includes(code),
    toggleFavorite: env.toggleFavorite,
  }),
}));
vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => ({ role: env.role }) }));

function anAuction(overrides: Partial<AuctionDetail> = {}): AuctionDetail {
  return {
    code: 'C-1',
    title: 'Casa em Palmas',
    address: {
      street: 'Quadra 104 Sul',
      neighborhood: 'Plano Diretor',
      city: 'Palmas',
      state: 'TO',
    },
    appraisalPrice: '500000.00',
    phases: [{ modality: 'OPEN_BIDDING', minimumPrice: '400000.00' }],
    ...overrides,
  };
}

beforeEach(() => {
  env.push.mockReset();
  env.toggleFavorite.mockReset();
  env.favorites = [];
  env.role = 'standard';
  window.history.replaceState(null, '', '/');
});

afterEach(() => vi.unstubAllGlobals());

describe('AuctionDetailClient favourite', () => {
  it('lets a Standard account add the property to the favourites', async () => {
    const auction = anAuction();
    const user = userEvent.setup();
    render(<AuctionDetailClient auction={auction} />);

    await user.click(screen.getByRole('button', { name: 'Adicionar aos favoritos' }));

    expect(env.toggleFavorite).toHaveBeenCalledWith(auction);
  });

  it('offers to remove a property that is already a favourite', () => {
    env.favorites = ['C-1'];
    render(<AuctionDetailClient auction={anAuction()} />);

    expect(screen.getByRole('button', { name: 'Remover dos favoritos' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Adicionar aos favoritos' }),
    ).not.toBeInTheDocument();
  });

  it.each(['free', 'unknown'])('offers no favourite button to a %s account', (role) => {
    env.role = role;
    render(<AuctionDetailClient auction={anAuction()} />);

    expect(screen.queryByRole('button', { name: /favoritos/ })).not.toBeInTheDocument();
  });
});

describe('AuctionDetailClient way back (first breadcrumb)', () => {
  it('goes home by default', async () => {
    const user = userEvent.setup();
    render(<AuctionDetailClient auction={anAuction()} />);

    await user.click(screen.getByRole('link', { name: 'Buscar imóveis' }));

    expect(env.push).toHaveBeenCalledWith('/');
  });

  it('goes back to the page the visitor came from when the link names it', async () => {
    window.history.replaceState(null, '', '/auction/C-1?returnUrl=%2Fsearch%3Fstate%3DTO');
    const user = userEvent.setup();
    render(<AuctionDetailClient auction={anAuction()} />);

    await user.click(screen.getByRole('link', { name: 'Buscar imóveis' }));

    expect(env.push).toHaveBeenCalledWith('/search?state=TO');
  });
});

describe('AuctionDetailClient header and image', () => {
  it('shows the title and the code', () => {
    render(<AuctionDetailClient auction={anAuction()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Casa em Palmas' })).toBeVisible();
    expect(screen.getByText('Código: C-1')).toBeVisible();
  });

  it('names an untitled property', () => {
    render(<AuctionDetailClient auction={anAuction({ title: '' })} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Imóvel sem título' })).toBeVisible();
  });

  it('shows the photo with the title as its text, and no placeholder', () => {
    render(
      <AuctionDetailClient auction={anAuction({ imageUrl: 'https://img.example.test/a.jpg' })} />,
    );

    expect(screen.getByRole('img', { name: 'Casa em Palmas' })).toHaveAttribute(
      'src',
      'https://img.example.test/a.jpg',
    );
    expect(screen.getByText('Sem imagem')).not.toBeVisible();
  });

  it('names the photo of an untitled property generically', () => {
    render(
      <AuctionDetailClient
        auction={anAuction({ title: '', imageUrl: 'https://img.example.test/a.jpg' })}
      />,
    );

    expect(screen.getByRole('img', { name: 'Imóvel' })).toBeInTheDocument();
  });

  it('swaps a photo that fails to load for the placeholder', () => {
    render(
      <AuctionDetailClient auction={anAuction({ imageUrl: 'https://img.example.test/a.jpg' })} />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'Casa em Palmas' }));

    expect(screen.getByText('Sem imagem')).toBeVisible();
    expect(screen.queryByRole('img', { name: 'Casa em Palmas' })).not.toBeInTheDocument();
  });

  it('shows the placeholder when there is no photo', () => {
    render(<AuctionDetailClient auction={anAuction()} />);

    expect(screen.getByText('Sem imagem')).toBeVisible();
  });
});

describe('AuctionDetailClient address and amounts', () => {
  it('joins the address parts that exist, and the zip code under it', () => {
    render(
      <AuctionDetailClient
        auction={anAuction({
          address: { street: 'Quadra 104 Sul', city: 'Palmas', state: 'TO', zipcode: '77000-000' },
        })}
      />,
    );

    expect(screen.getByText('Quadra 104 Sul, Palmas, TO')).toBeVisible();
    expect(screen.getByText('CEP: 77000-000')).toBeVisible();
  });

  it('says the address is missing when Caixa gave none', () => {
    render(<AuctionDetailClient auction={anAuction({ address: {} })} />);

    expect(screen.getByText('Endereço não informado')).toBeVisible();
    expect(screen.queryByText(/^CEP:/)).not.toBeInTheDocument();
  });

  it('leaves the appraisal out, not as R$ 0,00, when Caixa did not publish one', () => {
    render(<AuctionDetailClient auction={anAuction({ appraisalPrice: null })} />);

    expect(screen.queryByText('Valor de avaliação')).not.toBeInTheDocument();
    expect(screen.queryByText(/R\$\s0,00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/de desconto$/)).not.toBeInTheDocument();
  });

  it('leaves the current minimum bid and the discount out when the last phase has none', () => {
    render(
      <AuctionDetailClient
        auction={anAuction({ phases: [{ modality: 'OPEN_BIDDING', minimumPrice: null }] })}
      />,
    );

    expect(screen.queryByText('Lance mínimo atual')).not.toBeInTheDocument();
    expect(screen.queryByText(/de desconto$/)).not.toBeInTheDocument();
  });

  it('shows a single auction date plainly, without a position', () => {
    render(
      <AuctionDetailClient
        auction={anAuction({
          phases: [
            {
              modality: 'OPEN_BIDDING',
              minimumPrice: '400000.00',
              phaseDates: ['2026-03-11T15:00:00.000Z'],
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('Data do leilão')).toBeVisible();
    expect(screen.queryByText(/º leilão:/)).not.toBeInTheDocument();
    // the card and the table both show it, in Brasília time
    expect(screen.getAllByText('11/03/2026 12:00').length).toBeGreaterThanOrEqual(1);
  });

  it('shows no phase section and no modality chip for a property without phases', () => {
    render(<AuctionDetailClient auction={anAuction({ phases: [] })} />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Histórico de fases')).not.toBeInTheDocument();
    expect(screen.queryByText('Licitação Aberta')).not.toBeInTheDocument();
  });
});

describe('AuctionDetailClient payment, expenses and documents', () => {
  it('lists the payment methods and the expense rules of the last phase', () => {
    render(
      <AuctionDetailClient
        auction={anAuction({
          phases: [
            {
              modality: 'OPEN_BIDDING',
              minimumPrice: '400000.00',
              paymentMethods: ['OWN_RESOURCES', 'FGTS'],
              expenseRules: [{ type: 'Condomínio', description: 'Pago pelo comprador' }],
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('Formas de pagamento aceitas')).toBeVisible();
    expect(screen.getAllByText('Recursos próprios').length).toBeGreaterThan(0);
    expect(screen.getByText('Regras para pagamento das despesas')).toBeVisible();
    expect(screen.getByText('Condomínio')).toBeVisible();
    expect(screen.getByText('Pago pelo comprador')).toBeVisible();
  });

  it('shows neither section when the last phase has none', () => {
    render(<AuctionDetailClient auction={anAuction()} />);

    expect(screen.queryByText('Formas de pagamento aceitas')).not.toBeInTheDocument();
    expect(screen.queryByText('Regras para pagamento das despesas')).not.toBeInTheDocument();
  });

  it('opens each document in a new tab', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const user = userEvent.setup();
    render(
      <AuctionDetailClient
        auction={anAuction({
          matriculaUrl: 'https://docs.example.test/matricula.pdf',
          editalUrl: 'https://docs.example.test/edital.pdf',
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Matrícula do imóvel' }));
    await user.click(screen.getByRole('button', { name: 'Edital e anexos' }));

    expect(open).toHaveBeenNthCalledWith(1, 'https://docs.example.test/matricula.pdf', '_blank');
    expect(open).toHaveBeenNthCalledWith(2, 'https://docs.example.test/edital.pdf', '_blank');
  });

  it('offers only the document that exists', () => {
    render(
      <AuctionDetailClient
        auction={anAuction({ editalUrl: 'https://docs.example.test/edital.pdf' })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Edital e anexos' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Matrícula do imóvel' })).not.toBeInTheDocument();
  });

  it('offers no documents section when there are none', () => {
    render(<AuctionDetailClient auction={anAuction()} />);

    expect(screen.queryByText('Documentos disponíveis')).not.toBeInTheDocument();
  });

  it('links to the Caixa page safely in a new tab, only when there is one', () => {
    const { unmount } = render(
      <AuctionDetailClient
        auction={anAuction({ detailsUrl: 'https://caixa.example.test/imovel/1' })}
      />,
    );

    const link = screen.getByRole('link', { name: 'Ver detalhes completos no site da Caixa' });
    expect(link).toHaveAttribute('href', 'https://caixa.example.test/imovel/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    unmount();

    render(<AuctionDetailClient auction={anAuction()} />);
    expect(
      screen.queryByRole('link', { name: 'Ver detalhes completos no site da Caixa' }),
    ).not.toBeInTheDocument();
  });

  it('shows the dates and payment of each phase in the table, "Não informado" when missing', () => {
    render(
      <AuctionDetailClient
        auction={anAuction({
          phases: [
            { modality: 'OPEN_BIDDING', minimumPrice: null },
            { modality: 'SFI_AUCTION', minimumPrice: '380000.50', paymentMethods: ['FINANCING'] },
          ],
        })}
      />,
    );

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getAllByText('Não informado').length).toBeGreaterThan(0);
    expect(within(rows[1] as HTMLElement).getByText('Financiamento')).toBeVisible();
  });

  it('has no accessibility violations', async () => {
    const { baseElement } = render(
      <main>
        <AuctionDetailClient
          auction={anAuction({
            imageUrl: 'https://img.example.test/a.jpg',
            matriculaUrl: 'https://docs.example.test/matricula.pdf',
            detailsUrl: 'https://caixa.example.test/imovel/1',
          })}
        />
      </main>,
    );

    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
