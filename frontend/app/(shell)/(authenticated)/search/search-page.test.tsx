import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import SearchPage from './page';

// #42: the search page follows the URL — view, filters, page and results — on every change, not
// only on mount. The router, the auth context and the heavy children are stand-ins (TS-03: no
// port to fake); what is asserted is what the page does with the URL.
const env = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
  role: 'standard',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(env.search),
  useRouter: () => ({ push: env.push }),
}));
vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => ({ role: env.role }) }));
vi.mock('@/app/contexts/SavedFiltersContext', () => ({
  SavedFiltersProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/app/components/SearchFilters', () => ({
  default: ({
    initialFilters,
    onSearch,
  }: {
    initialFilters: Record<string, unknown>;
    onSearch: (filters: Record<string, unknown>) => void;
  }) => (
    <div>
      <p data-testid="form">{JSON.stringify(initialFilters)}</p>
      <button type="button" onClick={() => onSearch({ state: 'RN' })}>
        Buscar RN
      </button>
      <button type="button" onClick={() => onSearch({})}>
        Buscar tudo
      </button>
    </div>
  ),
}));
vi.mock('@/app/components/AuctionList', () => ({
  default: ({
    total,
    page,
    onPageChange,
  }: {
    total: number;
    page: number;
    onPageChange: (page: number) => void;
  }) => (
    <div>
      <p data-testid="results">{`total ${total} página ${page}`}</p>
      <button type="button" onClick={() => onPageChange(page + 1)}>
        Próxima página
      </button>
    </div>
  ),
}));
vi.mock('@/app/components/FavoritesView', () => ({
  default: () => <p>Lista de favoritos</p>,
}));

interface Pending {
  url: string;
  resolve: (total: number) => void;
}
let pending: Pending[] = [];

beforeEach(() => {
  env.search = '';
  env.role = 'standard';
  env.push.mockReset();
  pending = [];
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string) =>
        new Promise((resolve) => {
          pending.push({
            url,
            resolve: (total) =>
              resolve({ ok: true, status: 200, json: async () => ({ total, items: [] }) }),
          });
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function answer(index: number, total: number) {
  await act(async () => {
    pending[index]?.resolve(total);
  });
}

const form = () => screen.getByTestId('form').textContent;

function navigate(rerender: (ui: React.ReactElement) => void, search: string) {
  env.search = search;
  rerender(<SearchPage />);
}

describe('search page — URL-driven state', () => {
  it('switches from favourites to a filtered search on Back', async () => {
    env.search = 'view=favorites';
    const { rerender } = render(<SearchPage />);
    expect(screen.getByText('Lista de favoritos')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    navigate(rerender, 'state=SP&page=2');

    expect(screen.queryByText('Lista de favoritos')).not.toBeInTheDocument();
    expect(form()).toBe(JSON.stringify({ state: 'SP' }));
    expect(pending).toHaveLength(1);
    // page 2 of 10: offset 10
    expect(pending[0]?.url).toContain('state=SP');
    expect(pending[0]?.url).toContain('offset=10');
    await answer(0, 7);
    expect(screen.getByTestId('results')).toHaveTextContent('total 7 página 2');
  });

  it('clears form and results when the URL drops its filters', async () => {
    env.search = 'state=SP';
    const { rerender } = render(<SearchPage />);
    await answer(0, 7);
    expect(screen.getByTestId('results')).toBeInTheDocument();

    navigate(rerender, 'view=favorites');
    expect(screen.getByText('Lista de favoritos')).toBeInTheDocument();

    navigate(rerender, '');
    expect(screen.queryByTestId('results')).not.toBeInTheDocument();
    expect(form()).toBe('{}');
    expect(pending).toHaveLength(1);
  });

  it('shows the search view to a role without favourites', () => {
    env.role = 'free';
    env.search = 'view=favorites';
    render(<SearchPage />);

    expect(screen.queryByText('Lista de favoritos')).not.toBeInTheDocument();
    expect(screen.getByTestId('form')).toBeInTheDocument();
  });

  it('keeps only the latest search when an older response arrives late', async () => {
    env.search = 'state=SP';
    const { rerender } = render(<SearchPage />);
    navigate(rerender, 'state=RJ');

    await answer(1, 3);
    await answer(0, 99);
    expect(screen.getByTestId('results')).toHaveTextContent('total 3');
  });

  it('puts a new search in the URL, and searches again when the URL is unchanged', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SearchPage />);

    await user.click(screen.getByRole('button', { name: 'Buscar RN' }));
    expect(env.push).toHaveBeenCalledWith('/search?state=RN');
    // the URL change, not the click, runs the search
    expect(pending).toHaveLength(0);

    navigate(rerender, 'state=RN');
    await waitFor(() => expect(pending).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: 'Buscar RN' }));
    expect(pending).toHaveLength(2);
    expect(env.push).toHaveBeenCalledTimes(1);
  });

  it('pages through an unfiltered search, and Back to the bare /search resets', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SearchPage />);

    // empty form on /search: the URL does not change, so the page searches directly
    await user.click(screen.getByRole('button', { name: 'Buscar tudo' }));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.url).not.toContain('state=');
    expect(pending[0]?.url).toContain('offset=0');
    await answer(0, 30);

    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(env.push).toHaveBeenLastCalledWith('/search?page=2');
    navigate(rerender, 'page=2');
    // page 2 of the unfiltered search: offset 10, still no filters
    expect(pending).toHaveLength(2);
    expect(pending[1]?.url).not.toContain('state=');
    expect(pending[1]?.url).toContain('offset=10');
    await answer(1, 30);
    expect(screen.getByTestId('results')).toHaveTextContent('total 30 página 2');

    // Back lands on the bare /search, which was not this page's own navigation: it resets
    navigate(rerender, '');
    expect(screen.queryByTestId('results')).not.toBeInTheDocument();
    expect(pending).toHaveLength(2);
  });

  it('searches again from page 2 when the empty form is re-submitted', async () => {
    const user = userEvent.setup();
    env.search = 'page=2';
    const { rerender } = render(<SearchPage />);
    expect(pending[0]?.url).toContain('offset=10');
    await answer(0, 30);

    await user.click(screen.getByRole('button', { name: 'Buscar tudo' }));
    expect(env.push).toHaveBeenLastCalledWith('/search');
    navigate(rerender, '');
    // the page's own navigation to the bare /search searches page 1
    expect(pending).toHaveLength(2);
    expect(pending[1]?.url).toContain('offset=0');
    await answer(1, 30);
    expect(screen.getByTestId('results')).toHaveTextContent('total 30 página 1');

    // and re-submitting on the same URL searches once more
    await user.click(screen.getByRole('button', { name: 'Buscar tudo' }));
    expect(pending).toHaveLength(3);
  });
});
