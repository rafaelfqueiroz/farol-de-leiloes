import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import messages from '@/messages/pt-BR.json';
import { renderWithProviders as render } from '@/test/render';
import SearchFilters from './SearchFilters';

// SPEC-005, SPEC-007: the search form. Which sections a plan unlocks (AI search: Premium; saved
// filters: Standard and up), what the form sends to the search, the neighbourhoods it asks the API
// for, and the saved-filter flows. The price range, the load-failure state and the save dialog's
// basics are in SearchFilters.test.tsx.
const env = vi.hoisted(() => ({
  auth: { role: 'premium' } as { role: string },
  saved: {} as Record<string, unknown>,
  report: vi.fn(),
}));
const fetchMock = vi.fn();

vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));
vi.mock('../contexts/SavedFiltersContext', () => ({ useSavedFilters: () => env.saved }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => env.auth }));

const NEIGHBORHOODS_URL = 'http://localhost:3000/api/auctions/neighborhoods';

type SavedFilter = { _id: string; name: string; filters: Record<string, unknown> };

function savedContext(savedFilters: SavedFilter[] = [], overrides: Record<string, unknown> = {}) {
  env.saved = {
    savedFilters,
    loading: false,
    loadFailed: false,
    isAuthenticated: true,
    saveFilter: vi.fn(),
    deleteFilter: vi.fn(),
    refreshFilters: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  env.auth = { role: 'premium' };
  env.report.mockReset();
  savedContext();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith(NEIGHBORHOODS_URL)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ neighborhoods: ['Capim Macio', 'Ponta Negra'] }),
      };
    }
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const sentBySearch = async (user: ReturnType<typeof userEvent.setup>, onSearch: () => void) => {
  await user.click(screen.getByRole('button', { name: 'Buscar imóveis' }));
  return (onSearch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
};

describe('SearchFilters AI search', () => {
  it('offers the AI field to a Premium account and an administrator', () => {
    for (const role of ['premium', 'admin']) {
      env.auth = { role };
      const { unmount } = render(<SearchFilters onSearch={vi.fn()} onAISearchResults={vi.fn()} />);

      expect(screen.getByPlaceholderText(messages.searchFilters.ai.placeholder)).toBeVisible();
      expect(screen.queryByText(messages.searchFilters.ai.locked.title)).not.toBeInTheDocument();
      unmount();
    }
  });

  it.each(['free', 'standard'])('locks it behind the plans page for a %s account', (role) => {
    env.auth = { role };
    render(<SearchFilters onSearch={vi.fn()} onAISearchResults={vi.fn()} />);

    expect(screen.getByText(messages.searchFilters.ai.locked.title)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Assine agora' })).toHaveAttribute('href', '/plans');
    expect(
      screen.queryByPlaceholderText(messages.searchFilters.ai.placeholder),
    ).not.toBeInTheDocument();
  });

  it('sends the description to the BFF and hands the results to the page', async () => {
    const results = { items: [{ code: '1' }], total: 1, page: 1, pageSize: 20 };
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => results });
    const onAISearchResults = vi.fn();
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} onAISearchResults={onAISearchResults} />);

    await user.type(
      screen.getByPlaceholderText(messages.searchFilters.ai.placeholder),
      'casa em natal até 300 mil',
    );
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() => expect(onAISearchResults).toHaveBeenCalledWith(results));
    expect(fetchMock).toHaveBeenCalledWith('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'casa em natal até 300 mil' }),
    });
  });

  it('searches on Enter too', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) });
    const onAISearchResults = vi.fn();
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} onAISearchResults={onAISearchResults} />);

    await user.type(
      screen.getByPlaceholderText(messages.searchFilters.ai.placeholder),
      'apartamento{Enter}',
    );

    await waitFor(() => expect(onAISearchResults).toHaveBeenCalledTimes(1));
  });

  it('keeps Search disabled for a blank description', async () => {
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} onAISearchResults={vi.fn()} />);
    const input = screen.getByPlaceholderText(messages.searchFilters.ai.placeholder);
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled();

    await user.type(input, '   {Enter}');

    expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls nothing when the page takes no AI results', async () => {
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);

    await user.type(
      screen.getByPlaceholderText(messages.searchFilters.ai.placeholder),
      'apartamento{Enter}',
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a refused search and gives the page nothing', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 'VALIDATION_FAILED', context: {} }),
    });
    const onAISearchResults = vi.fn();
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} onAISearchResults={onAISearchResults} />);

    await user.type(
      screen.getByPlaceholderText(messages.searchFilters.ai.placeholder),
      'apartamento{Enter}',
    );

    await waitFor(() =>
      expect(env.report).toHaveBeenCalledWith(expect.any(ApiError), {
        where: 'SearchFilters.aiSearch',
      }),
    );
    expect(onAISearchResults).not.toHaveBeenCalled();
    // the field is usable again
    expect(screen.getByPlaceholderText(messages.searchFilters.ai.placeholder)).toBeEnabled();
  });

  it('disables the field and says it is searching while the request is on its way', async () => {
    let finish: (value: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} onAISearchResults={vi.fn()} />);

    await user.type(
      screen.getByPlaceholderText(messages.searchFilters.ai.placeholder),
      'apartamento{Enter}',
    );

    expect(await screen.findByRole('button', { name: 'Buscando…' })).toBeDisabled();
    expect(screen.getByPlaceholderText(messages.searchFilters.ai.placeholder)).toBeDisabled();
    finish({ ok: true, status: 200, json: async () => ({ items: [] }) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buscar' })).toBeInTheDocument());
  });
});

describe('SearchFilters panel', () => {
  it('closes to a tab and opens again', async () => {
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: 'Abrir filtros de busca' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fechar filtros de busca' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir filtros de busca' }));

    expect(await screen.findByRole('button', { name: 'Fechar filtros de busca' })).toBeVisible();
  });

  it('disables Search and Clear and says it is searching while the page loads', () => {
    render(<SearchFilters onSearch={vi.fn()} isLoading />);

    expect(screen.getByRole('button', { name: 'Buscando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Limpar Filtros' })).toBeDisabled();
  });

  it('follows the filters of the URL when they change', () => {
    const { rerender } = render(
      <SearchFilters onSearch={vi.fn()} initialFilters={{ state: 'RN' }} />,
    );
    expect(screen.getByRole('combobox', { name: 'Estado' })).toHaveTextContent(
      'Rio Grande do Norte',
    );

    rerender(<SearchFilters onSearch={vi.fn()} initialFilters={{ state: 'SP' }} />);

    expect(screen.getByRole('combobox', { name: 'Estado' })).toHaveTextContent('São Paulo');
  });
});

describe('SearchFilters location', () => {
  it('sends the state picked from the list', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchFilters onSearch={onSearch} />);

    await user.click(screen.getByRole('combobox', { name: 'Estado' }));
    await user.click(await screen.findByRole('option', { name: 'Rio Grande do Norte' }));

    expect(await sentBySearch(user, onSearch)).toMatchObject({ state: 'RN' });
  });

  it('sends no state after "Todos os estados"', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchFilters onSearch={onSearch} initialFilters={{ state: 'RN' }} />);

    await user.click(screen.getByRole('combobox', { name: 'Estado' }));
    await user.click(await screen.findByRole('option', { name: 'Todos os estados' }));

    expect((await sentBySearch(user, onSearch)).state).toBeUndefined();
  });

  it('offers the cities of the chosen state only', async () => {
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} initialFilters={{ state: 'RN' }} />);

    await user.click(screen.getByRole('combobox', { name: /^Cidade/ }));
    const listbox = await screen.findByRole('listbox');

    expect(within(listbox).getByRole('option', { name: 'Natal' })).toBeVisible();
    expect(within(listbox).queryByRole('option', { name: 'Salvador' })).not.toBeInTheDocument();
  });

  it('says so when no city matches what is typed', async () => {
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} initialFilters={{ state: 'RN' }} />);

    await user.type(screen.getByRole('combobox', { name: /^Cidade/ }), 'zzzz');

    expect(await screen.findByText('Nenhuma cidade encontrada')).toBeVisible();
  });

  it('drops the cities and neighbourhoods when the state changes', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchFilters
        onSearch={onSearch}
        initialFilters={{ state: 'RN', city: ['Natal'], neighborhood: ['Ponta Negra'] }}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Estado' }));
    await user.click(await screen.findByRole('option', { name: 'São Paulo' }));

    const sent = await sentBySearch(user, onSearch);
    expect(sent).toMatchObject({ state: 'SP' });
    expect(sent.city).toBeUndefined();
    expect(sent.neighborhood).toBeUndefined();
  });

  it('sends the cities picked, several at once', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchFilters onSearch={onSearch} initialFilters={{ state: 'RN' }} />);

    await user.click(screen.getByRole('combobox', { name: /^Cidade/ }));
    await user.click(await screen.findByRole('option', { name: 'Natal' }));
    await user.click(await screen.findByRole('option', { name: 'Mossoró' }));

    expect(await sentBySearch(user, onSearch)).toMatchObject({ city: ['Natal', 'Mossoró'] });
  });

  it('sends no city after the last one is removed', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchFilters onSearch={onSearch} initialFilters={{ state: 'RN', city: ['Natal'] }} />);

    // Backspace in the empty input removes the last chip
    await user.click(screen.getByRole('combobox', { name: /^Cidade/ }));
    await user.keyboard('{Backspace}');

    expect((await sentBySearch(user, onSearch)).city).toBeUndefined();
  });
});

describe('SearchFilters neighbourhoods', () => {
  it('asks the API for the neighbourhoods of the chosen cities and offers them', async () => {
    const user = userEvent.setup();
    render(
      <SearchFilters
        onSearch={vi.fn()}
        initialFilters={{ state: 'RN', city: ['Natal', 'Parnamirim'] }}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      `${NEIGHBORHOODS_URL}?state=RN&city=Natal&city=Parnamirim`,
    );
    await user.click(screen.getByRole('combobox', { name: /^Bairro/ }));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: 'Capim Macio' })).toBeVisible();
    expect(within(listbox).getByRole('option', { name: 'Ponta Negra' })).toBeVisible();
  });

  it('encodes the city names in the query', async () => {
    render(
      <SearchFilters
        onSearch={vi.fn()}
        initialFilters={{ state: 'MG', city: ['São João del-Rei'] }}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      `${NEIGHBORHOODS_URL}?state=MG&city=${encodeURIComponent('São João del-Rei')}`,
    );
  });

  it('sends the neighbourhoods picked', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchFilters onSearch={onSearch} initialFilters={{ state: 'RN', city: ['Natal'] }} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('combobox', { name: /^Bairro/ }));
    await user.click(await screen.findByRole('option', { name: 'Ponta Negra' }));

    expect(await sentBySearch(user, onSearch)).toMatchObject({ neighborhood: ['Ponta Negra'] });
  });

  it('is disabled, and asks for nothing, until a city is chosen', () => {
    render(<SearchFilters onSearch={vi.fn()} initialFilters={{ state: 'RN' }} />);

    expect(screen.getByRole('combobox', { name: /^Bairro/ })).toBeDisabled();
    expect(screen.getByPlaceholderText('Selecione uma cidade primeiro')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for nothing when a city is chosen but no state', () => {
    render(<SearchFilters onSearch={vi.fn()} initialFilters={{ city: ['Natal'] }} />);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the status and offers none when the API refuses', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} initialFilters={{ state: 'RN', city: ['Natal'] }} />);

    await waitFor(() =>
      expect(env.report).toHaveBeenCalledWith(
        new Error('Fetching neighborhoods failed with HTTP 503'),
        { where: 'SearchFilters.neighborhoods' },
      ),
    );
    await user.click(screen.getByRole('combobox', { name: /^Bairro/ }));
    expect(await screen.findByText('Nenhum bairro encontrado')).toBeVisible();
  });

  it('reports a network failure and offers none', async () => {
    const failure = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(failure);
    render(<SearchFilters onSearch={vi.fn()} initialFilters={{ state: 'RN', city: ['Natal'] }} />);

    await waitFor(() =>
      expect(env.report).toHaveBeenCalledWith(failure, { where: 'SearchFilters.neighborhoods' }),
    );
  });

  it('offers none when the API answers without a list', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} initialFilters={{ state: 'RN', city: ['Natal'] }} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('combobox', { name: /^Bairro/ }));

    expect(await screen.findByText('Nenhum bairro encontrado')).toBeVisible();
  });
});

describe('SearchFilters modality and reset', () => {
  it('sends the modalities ticked, and none once they are all unticked', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchFilters onSearch={onSearch} />);

    await user.click(screen.getByRole('checkbox', { name: 'Venda Online' }));
    await user.click(screen.getByRole('checkbox', { name: 'Licitação Aberta' }));
    expect(await sentBySearch(user, onSearch)).toMatchObject({
      modality: ['ONLINE_SALES', 'OPEN_BIDDING'],
    });

    await user.click(screen.getByRole('checkbox', { name: 'Venda Online' }));
    expect(await sentBySearch(user, onSearch)).toMatchObject({ modality: ['OPEN_BIDDING'] });

    await user.click(screen.getByRole('checkbox', { name: 'Licitação Aberta' }));
    expect((await sentBySearch(user, onSearch)).modality).toBeUndefined();
  });

  it('clears every filter, the price range included', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchFilters
        onSearch={onSearch}
        initialFilters={{
          state: 'RN',
          modality: ['ONLINE_SALES'],
          minPrice: '100000.00',
          maxPrice: '900000.00',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Limpar Filtros' }));

    const sent = await sentBySearch(user, onSearch);
    expect(sent.state).toBeUndefined();
    expect(sent.modality).toBeUndefined();
    expect(sent.minPrice).toBeUndefined();
    expect(sent.maxPrice).toBeUndefined();
    expect(screen.getByRole('checkbox', { name: 'Venda Online' })).not.toBeChecked();
  });
});

describe('SearchFilters saved filters', () => {
  const casas: SavedFilter = {
    _id: 'f1',
    name: 'Casas em Natal',
    filters: {
      state: 'RN',
      city: ['Natal'],
      modality: ['ONLINE_SALES'],
      minPrice: '100000.00',
      maxPrice: '900000.00',
    },
  };

  beforeEach(() => {
    env.auth = { role: 'standard' };
  });

  it.each([
    ['a free account', { role: 'free' }, true],
    ['a signed-out visitor', { role: 'standard' }, false],
  ])('is not offered to %s', (_name, auth, authenticated) => {
    env.auth = auth;
    savedContext([casas], { isAuthenticated: authenticated });
    render(<SearchFilters onSearch={vi.fn()} />);

    expect(screen.queryByText('Filtros Salvos')).not.toBeInTheDocument();
  });

  it('fills the form from the saved filter picked and searches with it', async () => {
    savedContext([casas]);
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchFilters onSearch={onSearch} />);

    await user.click(screen.getByRole('combobox', { name: 'Selecione um filtro' }));
    await user.click(await screen.findByRole('option', { name: /Casas em Natal/ }));

    expect(screen.getByRole('combobox', { name: 'Estado' })).toHaveTextContent(
      'Rio Grande do Norte',
    );
    expect(screen.getByText('R$ 100 mil - R$ 900 mil')).toBeVisible();
    expect(await sentBySearch(user, onSearch)).toEqual({
      state: 'RN',
      city: ['Natal'],
      neighborhood: undefined,
      modality: ['ONLINE_SALES'],
      minPrice: '100000.00',
      maxPrice: '900000.00',
    });
  });

  it('leaves the form as it is when "Nenhum selecionado" is picked', async () => {
    savedContext([casas]);
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} initialFilters={{ state: 'SP' }} />);

    await user.click(screen.getByRole('combobox', { name: 'Selecione um filtro' }));
    await user.click(await screen.findByRole('option', { name: 'Nenhum selecionado' }));

    expect(screen.getByRole('combobox', { name: 'Estado' })).toHaveTextContent('São Paulo');
  });

  it('disables the picker while the filters load', () => {
    savedContext([casas], { loading: true });
    render(<SearchFilters onSearch={vi.fn()} />);

    expect(screen.getByRole('combobox', { name: 'Selecione um filtro' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('forgets the selection when the selected filter is removed', async () => {
    savedContext([casas], { deleteFilter: vi.fn().mockResolvedValue(true) });
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);
    await user.click(screen.getByRole('combobox', { name: 'Selecione um filtro' }));
    await user.click(await screen.findByRole('option', { name: /Casas em Natal/ }));
    // the open menu hides the rest of the page; and once something is selected the combobox's
    // name also carries the selected value
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    const picker = () => screen.getByRole('combobox', { name: /Selecione um filtro/ });
    expect(picker()).toHaveTextContent('Casas em Natal');

    await user.click(picker());
    await user.click(await screen.findByRole('button', { name: 'Excluir filtro Casas em Natal' }));

    expect(await screen.findByText(messages.searchFilters.snackbar.removed)).toBeVisible();
    // removing a row does not close the menu
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(picker()).not.toHaveTextContent('Casas em Natal');
  });

  it('keeps the filter, and says nothing, when the removal fails', async () => {
    savedContext([casas], { deleteFilter: vi.fn().mockResolvedValue(false) });
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);

    await user.click(screen.getByRole('combobox', { name: 'Selecione um filtro' }));
    await user.click(await screen.findByRole('button', { name: 'Excluir filtro Casas em Natal' }));

    expect(screen.queryByText(messages.searchFilters.snackbar.removed)).not.toBeInTheDocument();
  });

  it('saves the current filters under the name typed, with Enter', async () => {
    const saveFilter = vi.fn().mockResolvedValue({});
    savedContext([], { saveFilter });
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} initialFilters={{ state: 'RN', city: ['Natal'] }} />);

    await user.click(screen.getByRole('button', { name: 'Salvar Filtros Atuais' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome do filtro' }), '  Natal  {Enter}');

    await waitFor(() => expect(saveFilter).toHaveBeenCalledTimes(1));
    expect(saveFilter).toHaveBeenCalledWith(
      'Natal',
      expect.objectContaining({ state: 'RN', city: ['Natal'] }),
    );
    expect(await screen.findByText(messages.searchFilters.snackbar.saved)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the catalogue message of the code, and keeps the dialog, when saving is refused', async () => {
    const saveFilter = vi.fn().mockRejectedValue(new ApiError('SAVED_FILTER_NAME_TAKEN', {}, 409));
    savedContext([], { saveFilter });
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Salvar Filtros Atuais' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome do filtro' }), 'Casas');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText(messages.errors.SAVED_FILTER_NAME_TAKEN)).toBeVisible();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(messages.searchFilters.snackbar.saved)).not.toBeInTheDocument();
  });

  it('closes the dialog on Cancel without saving, and starts empty next time', async () => {
    const saveFilter = vi.fn();
    savedContext([], { saveFilter });
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Salvar Filtros Atuais' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome do filtro' }), 'Casas');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Salvar Filtros Atuais' }));

    expect(screen.getByRole('textbox', { name: 'Nome do filtro' })).toHaveValue('');
    expect(saveFilter).not.toHaveBeenCalled();
  });

  it('keeps Save disabled until there is a name', async () => {
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Salvar Filtros Atuais' }));

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });
});
