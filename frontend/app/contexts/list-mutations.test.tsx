import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import type { Auction } from '@/lib/auction';
import { FavoritesProvider, useFavorites } from './FavoritesContext';
import { RemindersProvider, useReminders, type Reminder } from './RemindersContext';
import { SavedFiltersProvider, useSavedFilters, type SavedFilter } from './SavedFiltersContext';

// What the favourites, reminders and saved-filters contexts do with each answer of the API: the
// optimistic list updates, the redirect to /login on a 401 (the session cookie is gone), the ApiError
// that reaches the caller (AR-38) and what is reported (SC-15). The reload on an account change
// is in user-scoped-providers.test.tsx and the paging in list-contexts.test.tsx.
const env = vi.hoisted(() => {
  const push = vi.fn();
  type Auth = { user: { _id: string } | null; loading: boolean };
  const signedIn: Auth = { user: { _id: 'u1' }, loading: false };
  return { push, router: { push }, report: vi.fn(), signedIn, auth: signedIn };
});
const signedOut = { user: null, loading: false };

vi.mock('next/navigation', () => ({ useRouter: () => env.router }));
// SC-02: nothing in the browser can read the session; "signed in" is the user AuthContext holds
vi.mock('./AuthContext', () => ({ useAuth: () => env.auth }));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));

type Answer = { status: number; body?: unknown } | Error;
type Router = (url: string, method: string) => Answer | undefined;

let route: Router;
let calls: Array<{
  url: string;
  method: string;
  body?: string;
  credentials?: string;
  authorization?: string;
}>;

beforeEach(() => {
  env.push.mockReset();
  env.report.mockReset();
  calls = [];
  route = () => undefined;
  env.auth = env.signedIn;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        body: init?.body as string | undefined,
        credentials: init?.credentials,
        authorization: (init?.headers as Record<string, string> | undefined)?.Authorization,
      });
      const answer = route(url, method);
      if (!answer) throw new Error(`unexpected request ${method} ${url}`);
      if (answer instanceof Error) throw answer;
      return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
    }),
  );
});

afterEach(() => {
  // SC-02: browser code never builds an Authorization header; the cookie rides along
  expect(calls.filter((call) => call.authorization !== undefined)).toEqual([]);
  expect(window.localStorage.length).toBe(0);
  vi.unstubAllGlobals();
});

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 100 });
const reportedWhere = () => env.report.mock.calls.map(([, context]) => context.where);

const auction = (code: string) => ({ code }) as Auction;

describe('FavoritesProvider', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FavoritesProvider>{children}</FavoritesProvider>
  );

  async function mounted(codes: string[] = []) {
    route = (url) =>
      url === '/api/favorites/codes' ? { status: 200, body: { codes } } : undefined;
    const hook = renderHook(() => useFavorites(), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it('loads the favourite codes once a user is signed in and answers isFavorite from them', async () => {
    const { result } = await mounted(['A', 'B']);

    expect(calls[0]).toMatchObject({ url: '/api/favorites/codes', credentials: 'same-origin' });
    expect(result.current.isFavorite('A')).toBe(true);
    expect(result.current.isFavorite('Z')).toBe(false);
  });

  it('has no favourites, and asks for none, when nobody is signed in', async () => {
    env.auth = signedOut;
    const { result } = renderHook(() => useFavorites(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(calls).toHaveLength(0);
    expect(result.current.favoriteCodes).toEqual([]);
  });

  it('clears the favourites when the API says the session is no longer valid', async () => {
    route = () => ({ status: 401, body: { code: 'UNAUTHENTICATED', context: {} } });
    const { result } = renderHook(() => useFavorites(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.favoriteCodes).toEqual([]);
    expect(env.report).not.toHaveBeenCalled();
  });

  it('reports the code of any other error and keeps the page usable', async () => {
    route = () => ({ status: 500, body: { code: 'INTERNAL_ERROR', context: {} } });
    const { result } = renderHook(() => useFavorites(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(env.report).toHaveBeenCalledWith(expect.objectContaining({ code: 'INTERNAL_ERROR' }), {
      where: 'FavoritesContext.load',
    });
  });

  it('sends a visitor who favourites a property to the login, calling nothing', async () => {
    const { result, rerender } = await mounted();
    env.auth = signedOut;
    rerender();
    calls = [];

    await act(() => result.current.toggleFavorite(auction('A')));

    expect(env.push).toHaveBeenCalledWith('/login');
    expect(calls).toHaveLength(0);
  });

  it('adds a favourite: POST with the code alone (AR-34), then the heart is on', async () => {
    const { result } = await mounted();
    route = (url, method) =>
      method === 'POST' && url === '/api/favorites'
        ? { status: 201, body: { code: 'A' } }
        : undefined;

    await act(() => result.current.toggleFavorite(auction('A')));

    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ code: 'A' }),
    });
    expect(result.current.isFavorite('A')).toBe(true);
    expect(result.current.favoriteCodes).toEqual(['A']);
  });

  it('removes a favourite that is already one: DELETE by code, then the heart is off', async () => {
    const { result } = await mounted(['A', 'B']);
    route = (url, method) =>
      method === 'DELETE' && url === '/api/favorites/A' ? { status: 204 } : undefined;

    await act(() => result.current.toggleFavorite(auction('A')));

    expect(result.current.favoriteCodes).toEqual(['B']);
  });

  it('sends the user to the login when an add is refused as unauthenticated', async () => {
    const { result } = await mounted();
    route = () => ({ status: 401, body: { code: 'UNAUTHENTICATED', context: {} } });

    await act(() => result.current.toggleFavorite(auction('A')));

    expect(env.push).toHaveBeenCalledWith('/login');
    expect(result.current.isFavorite('A')).toBe(false);
  });

  it('sends the user to the login when a removal is refused as unauthenticated', async () => {
    const { result } = await mounted(['A']);
    route = () => ({ status: 401, body: { code: 'UNAUTHENTICATED', context: {} } });

    await act(() => result.current.toggleFavorite(auction('A')));

    expect(env.push).toHaveBeenCalledWith('/login');
    expect(result.current.isFavorite('A')).toBe(true);
  });

  const unconfirmed = { status: 403, body: { code: 'EMAIL_VERIFICATION_REQUIRED', context: {} } };

  it('BR-001-04: an unconfirmed account reads no favourites and nothing is reported (the banner says why)', async () => {
    route = () => unconfirmed;
    const { result } = renderHook(() => useFavorites(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.favoriteCodes).toEqual([]);
    expect(env.report).not.toHaveBeenCalled();
  });

  it('BR-001-04: a heart refused for an unconfirmed e-mail stays off, with no report and no redirect', async () => {
    const { result } = await mounted();
    route = () => unconfirmed;

    await act(() => result.current.toggleFavorite(auction('A')));

    expect(result.current.isFavorite('A')).toBe(false);
    expect(env.report).not.toHaveBeenCalled();
    expect(env.push).not.toHaveBeenCalled();
  });

  it('reports a refused add and leaves the heart off', async () => {
    const { result } = await mounted();
    route = () => ({ status: 400, body: { code: 'VALIDATION_FAILED', context: {} } });

    await act(() => result.current.toggleFavorite(auction('A')));

    expect(env.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      {
        where: 'FavoritesContext.toggleFavorite',
      },
    );
    expect(result.current.isFavorite('A')).toBe(false);
  });

  it('reports a network failure on an add and on a removal', async () => {
    const { result } = await mounted(['B']);
    route = () => new TypeError('Failed to fetch');

    await act(() => result.current.toggleFavorite(auction('A')));
    await act(() => result.current.toggleFavorite(auction('B')));

    expect(reportedWhere()).toEqual([
      'FavoritesContext.toggleFavorite',
      'FavoritesContext.toggleFavorite',
    ]);
    expect(result.current.favoriteCodes).toEqual(['B']);
  });

  it('removeFavorite deletes by code', async () => {
    const { result } = await mounted(['A', 'B']);
    route = (url, method) =>
      method === 'DELETE' && url === '/api/favorites/A' ? { status: 200, body: {} } : undefined;

    await act(() => result.current.removeFavorite('A'));

    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', credentials: 'same-origin' });
    expect(result.current.favoriteCodes).toEqual(['B']);
  });

  it('removeFavorite keeps the favourite when the API refuses', async () => {
    const { result } = await mounted(['A']);
    route = () => ({ status: 500, body: { code: 'INTERNAL_ERROR', context: {} } });

    await act(() => result.current.removeFavorite('A'));

    expect(result.current.favoriteCodes).toEqual(['A']);
  });

  it('removeFavorite reports a network failure', async () => {
    const { result } = await mounted(['A']);
    route = () => new TypeError('Failed to fetch');

    await act(() => result.current.removeFavorite('A'));

    expect(reportedWhere()).toEqual(['FavoritesContext.removeFavorite']);
    expect(result.current.favoriteCodes).toEqual(['A']);
  });

  it('is only usable inside the provider', () => {
    // React reports the throw on the console even though the test expects it
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useFavorites())).toThrow(
      'useFavorites must be used within a FavoritesProvider',
    );

    spy.mockRestore();
  });
});

describe('RemindersProvider mutations', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RemindersProvider>{children}</RemindersProvider>
  );

  const reminder = (id: string, code: string, description: string | null = null) =>
    ({
      _id: id,
      channel: 'EMAIL',
      scheduledAt: '2026-11-14T13:00:00Z',
      description,
      status: 'PENDING',
      createdAt: '2026-11-01T12:00:00Z',
      auction: { _id: `a-${code}`, code, title: null, city: null, state: null, detailsUrl: null },
    }) satisfies Reminder;

  async function mounted(items: Reminder[] = []) {
    route = (url) =>
      url.startsWith('/api/reminders?') ? { status: 200, body: page(items) } : undefined;
    const hook = renderHook(() => useReminders(), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  const newReminder = {
    auctionId: 'a-X',
    channel: 'EMAIL' as const,
    scheduledAt: '2026-11-14T13:00:00Z',
  };

  it('finds the reminder of an auction by its code', async () => {
    const { result } = await mounted([reminder('r1', 'A'), reminder('r2', 'B')]);

    expect(result.current.hasReminderForAuction('A')).toBe(true);
    expect(result.current.hasReminderForAuction('Z')).toBe(false);
    expect(result.current.getReminderForAuction('B')?._id).toBe('r2');
    expect(result.current.getReminderForAuction('Z')).toBeUndefined();
  });

  it('clears the list, without flagging a failure, when the session is no longer valid', async () => {
    route = () => ({ status: 401, body: { code: 'UNAUTHENTICATED', context: {} } });
    const { result } = renderHook(() => useReminders(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.reminders).toEqual([]);
    expect(result.current.loadFailed).toBe(false);
  });

  it('has nothing, and asks for nothing, when nobody is signed in', async () => {
    env.auth = signedOut;
    const { result } = renderHook(() => useReminders(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(calls).toHaveLength(0);
    expect(result.current.reminders).toEqual([]);
  });

  it('refreshReminders reads the list again', async () => {
    const { result } = await mounted([reminder('r1', 'A')]);
    route = (url) =>
      url.startsWith('/api/reminders?')
        ? { status: 200, body: page([reminder('r1', 'A'), reminder('r2', 'B')]) }
        : undefined;

    await act(() => result.current.refreshReminders());

    expect(result.current.reminders.map((r) => r._id)).toEqual(['r1', 'r2']);
    expect(result.current.loading).toBe(false);
  });

  // each mutation, and what it resolves to when it did nothing
  type Mutation = [
    name: string,
    run: (r: ReturnType<typeof useReminders>) => Promise<unknown>,
    nothingDone: unknown,
  ];
  const mutations: Mutation[] = [
    ['createReminder', (r) => r.createReminder(newReminder), null],
    ['updateReminder', (r) => r.updateReminder('r1', {}), false],
    ['deleteReminder', (r) => r.deleteReminder('r1'), false],
  ];

  describe('when nobody is signed in', () => {
    it.each(mutations)(
      '%s sends the visitor to the login and calls nothing',
      async (_name, run, expected) => {
        const { result, rerender } = await mounted();
        env.auth = signedOut;
        rerender();
        calls = [];

        const outcome = await act(() => run(result.current));

        expect(outcome).toBe(expected);
        expect(env.push).toHaveBeenCalledWith('/login');
        expect(calls).toHaveLength(0);
      },
    );
  });

  it('createReminder posts the data and adds the reminder the API answered with', async () => {
    const { result } = await mounted();
    const created = reminder('r9', 'X');
    route = (url, method) =>
      method === 'POST' && url === '/api/reminders' ? { status: 201, body: created } : undefined;

    const outcome = await act(() => result.current.createReminder(newReminder));

    expect(outcome).toEqual(created);
    expect(calls.at(-1)).toMatchObject({
      credentials: 'same-origin',
      body: JSON.stringify(newReminder),
    });
    expect(result.current.reminders).toEqual([created]);
  });

  it('updateReminder patches and swaps in the reminder the API answered with', async () => {
    const { result } = await mounted([reminder('r1', 'A'), reminder('r2', 'B')]);
    route = (url, method) =>
      method === 'PATCH' && url === '/api/reminders/r1'
        ? { status: 200, body: reminder('r1', 'A', 'novo texto') }
        : undefined;

    const outcome = await act(() =>
      result.current.updateReminder('r1', { description: 'novo texto' }),
    );

    expect(outcome).toBe(true);
    expect(calls.at(-1)?.body).toBe(JSON.stringify({ description: 'novo texto' }));
    expect(result.current.reminders.map((r) => r.description)).toEqual(['novo texto', null]);
  });

  it('deleteReminder deletes and drops the reminder', async () => {
    const { result } = await mounted([reminder('r1', 'A'), reminder('r2', 'B')]);
    route = (url, method) =>
      method === 'DELETE' && url === '/api/reminders/r1' ? { status: 204 } : undefined;

    const outcome = await act(() => result.current.deleteReminder('r1'));

    expect(outcome).toBe(true);
    expect(result.current.reminders.map((r) => r._id)).toEqual(['r2']);
  });

  describe('when the session is refused', () => {
    it.each(mutations)('%s sends the user to the login', async (_name, run, expected) => {
      const { result } = await mounted([reminder('r1', 'A')]);
      route = () => ({ status: 401, body: { code: 'UNAUTHENTICATED', context: {} } });

      const outcome = await act(() => run(result.current));

      expect(outcome).toBe(expected);
      expect(env.push).toHaveBeenCalledWith('/login');
      expect(result.current.reminders).toHaveLength(1);
    });
  });

  describe('when the API refuses', () => {
    it.each([
      [
        'createReminder',
        (r: ReturnType<typeof useReminders>) => r.createReminder(newReminder),
        'RemindersContext.createReminder',
      ],
      [
        'updateReminder',
        (r: ReturnType<typeof useReminders>) => r.updateReminder('r1', {}),
        'RemindersContext.updateReminder',
      ],
      [
        'deleteReminder',
        (r: ReturnType<typeof useReminders>) => r.deleteReminder('r1'),
        'RemindersContext.deleteReminder',
      ],
    ])('%s rejects with the ApiError and reports it', async (_name, run, where) => {
      const { result } = await mounted([reminder('r1', 'A')]);
      route = () => ({
        status: 409,
        body: { code: 'REMINDER_ALREADY_SENT', context: {} },
      });

      let error: unknown;
      await act(async () => {
        error = await run(result.current).catch((caught: unknown) => caught);
      });

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'REMINDER_ALREADY_SENT', status: 409 });
      expect(env.report).toHaveBeenCalledWith(error, { where });
      expect(result.current.reminders).toHaveLength(1);
    });
  });

  it('is only usable inside the provider', () => {
    // React reports the throw on the console even though the test expects it
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useReminders())).toThrow(
      'useReminders must be used within a RemindersProvider',
    );

    spy.mockRestore();
  });
});

describe('SavedFiltersProvider mutations', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SavedFiltersProvider>{children}</SavedFiltersProvider>
  );

  const filter = (id: string, name: string) =>
    ({
      _id: id,
      name,
      filters: { state: 'RN' },
      createdAt: '2026-11-01T12:00:00Z',
      updatedAt: '2026-11-01T12:00:00Z',
    }) satisfies SavedFilter;

  async function mounted(items: SavedFilter[] = []) {
    route = (url) =>
      url.startsWith('/api/saved-filters?') ? { status: 200, body: page(items) } : undefined;
    const hook = renderHook(() => useSavedFilters(), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it('is signed in, with its filters, when a user is signed in', async () => {
    const { result } = await mounted([filter('f1', 'Natal')]);

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.savedFilters.map((f) => f.name)).toEqual(['Natal']);
    expect(calls[0]).toMatchObject({ credentials: 'same-origin' });
  });

  it('is signed out, and asks for nothing, when nobody is signed in', async () => {
    env.auth = signedOut;
    const { result } = renderHook(() => useSavedFilters(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(calls).toHaveLength(0);
    expect(result.current.isAuthenticated).toBe(false);
    expect(await result.current.saveFilter('Natal', {})).toBeNull();
    expect(await result.current.deleteFilter('f1')).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('has no filters, and does not flag a failure, when the API says the session is no longer valid', async () => {
    route = () => ({ status: 401, body: { code: 'UNAUTHENTICATED', context: {} } });
    const { result } = renderHook(() => useSavedFilters(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.savedFilters).toEqual([]);
    expect(result.current.loadFailed).toBe(false);
  });

  it('flags the failure, and reports it, when the list cannot be read', async () => {
    route = () => ({ status: 500, body: { code: 'INTERNAL_ERROR', context: {} } });
    const { result } = renderHook(() => useSavedFilters(), { wrapper });

    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    expect(reportedWhere()).toEqual(['SavedFiltersContext.load']);
  });

  it('refreshFilters reads the list again', async () => {
    const { result } = await mounted([filter('f1', 'Natal')]);
    route = (url) =>
      url.startsWith('/api/saved-filters?')
        ? { status: 200, body: page([filter('f1', 'Natal'), filter('f2', 'Recife')]) }
        : undefined;

    await act(() => result.current.refreshFilters());

    expect(result.current.savedFilters.map((f) => f.name)).toEqual(['Natal', 'Recife']);
  });

  it('saveFilter posts the name and filters and puts the new filter first', async () => {
    const { result } = await mounted([filter('f1', 'Natal')]);
    const created = filter('f2', 'Recife');
    route = (url, method) =>
      method === 'POST' && url === '/api/saved-filters'
        ? { status: 201, body: created }
        : undefined;

    const outcome = await act(() => result.current.saveFilter('Recife', { state: 'PE' }));

    expect(outcome).toEqual(created);
    expect(calls.at(-1)?.body).toBe(JSON.stringify({ name: 'Recife', filters: { state: 'PE' } }));
    expect(result.current.savedFilters.map((f) => f._id)).toEqual(['f2', 'f1']);
  });

  it('saveFilter rejects with the ApiError of the answer and reports it', async () => {
    const { result } = await mounted();
    route = () => ({ status: 409, body: { code: 'SAVED_FILTER_NAME_TAKEN', context: {} } });

    let error: unknown;
    await act(async () => {
      error = await result.current.saveFilter('Natal', {}).catch((caught: unknown) => caught);
    });

    expect(error).toMatchObject({ code: 'SAVED_FILTER_NAME_TAKEN', status: 409 });
    expect(env.report).toHaveBeenCalledWith(error, { where: 'SavedFiltersContext.saveFilter' });
    expect(result.current.savedFilters).toEqual([]);
  });

  it('deleteFilter deletes by id and drops the filter', async () => {
    const { result } = await mounted([filter('f1', 'Natal'), filter('f2', 'Recife')]);
    route = (url, method) =>
      method === 'DELETE' && url === '/api/saved-filters/f1' ? { status: 204 } : undefined;

    const outcome = await act(() => result.current.deleteFilter('f1'));

    expect(outcome).toBe(true);
    expect(result.current.savedFilters.map((f) => f._id)).toEqual(['f2']);
  });

  it('deleteFilter keeps the filter, and reports, when the API refuses', async () => {
    const { result } = await mounted([filter('f1', 'Natal')]);
    route = () => ({ status: 404, body: { code: 'SAVED_FILTER_NOT_FOUND', context: {} } });

    const outcome = await act(() => result.current.deleteFilter('f1'));

    expect(outcome).toBe(false);
    expect(reportedWhere()).toEqual(['SavedFiltersContext.deleteFilter']);
    expect(result.current.savedFilters).toHaveLength(1);
  });

  it('deleteFilter keeps the filter, and reports, on a network failure', async () => {
    const { result } = await mounted([filter('f1', 'Natal')]);
    route = () => new TypeError('Failed to fetch');

    const outcome = await act(() => result.current.deleteFilter('f1'));

    expect(outcome).toBe(false);
    expect(reportedWhere()).toEqual(['SavedFiltersContext.deleteFilter']);
    expect(result.current.savedFilters).toHaveLength(1);
  });

  it('is only usable inside the provider', () => {
    // React reports the throw on the console even though the test expects it
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useSavedFilters())).toThrow(
      'useSavedFilters must be used within a SavedFiltersProvider',
    );

    spy.mockRestore();
  });
});
