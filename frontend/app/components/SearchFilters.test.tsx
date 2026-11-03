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
