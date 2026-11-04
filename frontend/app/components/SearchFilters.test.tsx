import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { renderWithProviders as render } from '@/test/render';
import SearchFilters from './SearchFilters';

// The saved filters section says so when the list could not be loaded.
const env = vi.hoisted(() => ({
  saved: {
    savedFilters: [] as unknown[],
    loading: false,
    loadFailed: false,
    isAuthenticated: true,
    saveFilter: vi.fn(),
    deleteFilter: vi.fn(),
    refreshFilters: vi.fn(),
  },
}));

vi.mock('@/lib/report-client-error', () => ({ reportClientError: vi.fn() }));
vi.mock('../contexts/SavedFiltersContext', () => ({ useSavedFilters: () => env.saved }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: 'standard' }) }));

beforeEach(() => {
  env.saved = {
    savedFilters: [],
    loading: false,
    loadFailed: false,
    isAuthenticated: true,
    saveFilter: vi.fn(),
    deleteFilter: vi.fn(),
    refreshFilters: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
  );
});

describe('SearchFilters saved filters load failure', () => {
  it('shows the ErrorState when the saved filters failed to load', () => {
    env.saved.loadFailed = true;
    render(<SearchFilters onSearch={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent(messages.loadFailed.savedFilters.title);
    expect(screen.getByRole('alert')).toHaveTextContent(messages.loadFailed.savedFilters.message);
  });

  it('retries the load from the ErrorState', async () => {
    env.saved.loadFailed = true;
    render(<SearchFilters onSearch={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: messages.patterns.errorState.retry }));

    expect(env.saved.refreshFilters).toHaveBeenCalledTimes(1);
  });

  it('shows no ErrorState when the saved filters loaded', () => {
    render(<SearchFilters onSearch={vi.fn()} />);

    expect(screen.queryByText(messages.loadFailed.savedFilters.title)).not.toBeInTheDocument();
  });
});

// AR-17: the slider moves JS numbers, but the filters leave the form as money strings.
describe('SearchFilters price range', () => {
  const search = () => screen.getByRole('button', { name: 'Buscar Imóveis' });

  it('sends the price bounds as money strings', async () => {
    const onSearch = vi.fn();
    render(
      <SearchFilters
        onSearch={onSearch}
        initialFilters={{ minPrice: '50000.00', maxPrice: '1500000.00' }}
      />,
    );

    await userEvent.click(search());

    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ minPrice: '50000.00', maxPrice: '1500000.00' }),
    );
  });

  it('sends no bound for a thumb left at the end of the slider', async () => {
    const onSearch = vi.fn();
    render(<SearchFilters onSearch={onSearch} initialFilters={{ minPrice: '100000' }} />);

    await userEvent.click(search());

    const sent = onSearch.mock.calls[0]?.[0];
    expect(sent.minPrice).toBe('100000.00');
    expect(sent.maxPrice).toBeUndefined();
  });

  it('saves the price bounds as money strings', async () => {
    env.saved.saveFilter.mockResolvedValue({});
    render(
      <SearchFilters
        onSearch={vi.fn()}
        initialFilters={{ minPrice: '250000.00', maxPrice: '1000000.00' }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /salvar filtro/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /nome/i }), 'Casas');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    expect(env.saved.saveFilter).toHaveBeenCalledWith(
      'Casas',
      expect.objectContaining({ minPrice: '250000.00', maxPrice: '1000000.00' }),
    );
  });

  it('labels the range with the shared compact money format', () => {
    render(
      <SearchFilters
        onSearch={vi.fn()}
        initialFilters={{ minPrice: '50000.00', maxPrice: '1500000.00' }}
      />,
    );

    expect(screen.getByText('R$ 50 mil - R$ 1,5 mi')).toBeInTheDocument();
  });
});
