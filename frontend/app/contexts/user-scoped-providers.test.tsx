import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FavoritesProvider, useFavorites } from './FavoritesContext';
import { RemindersProvider, useReminders } from './RemindersContext';

// #42: favourites and reminders follow who is signed in — fetched at once when a token exists,
// reloaded on a change of user, cleared on sign-out — and a late response for a previous user
// never overwrites the current data. Auth and the router have no port to fake (TS-03).
const env = vi.hoisted(() => ({
  auth: { user: null as { _id: string } | null, loading: true },
  listeners: new Set<() => void>(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('./AuthContext', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    env.listeners.add(listener);
    return () => env.listeners.delete(listener);
  };
  return { useAuth: () => useSyncExternalStore(subscribe, () => env.auth) };
});

function setAuth(next: typeof env.auth) {
  act(() => {
    env.auth = next;
    env.listeners.forEach((listener) => listener());
  });
}

const resolvedAs = (id: string | null) => ({ user: id ? { _id: id } : null, loading: false });

interface Pending {
  url: string;
  method: string;
  resolve: (body: unknown) => void;
}
let pending: Pending[] = [];

function FavoritesProbe() {
  const { favorites, loading } = useFavorites();
  return <p>{loading ? 'carregando' : `itens ${favorites.length}`}</p>;
}

function RemindersProbe() {
  const { reminders, loading } = useReminders();
  return <p>{loading ? 'carregando' : `itens ${reminders.length}`}</p>;
}

const providers: [string, string, (props: { children: ReactNode }) => ReactNode, () => ReactNode][] = [
  ['FavoritesProvider', '/api/favorites', FavoritesProvider, FavoritesProbe],
  ['RemindersProvider', '/api/reminders', RemindersProvider, RemindersProbe],
];

beforeEach(() => {
  env.auth = { user: null, loading: true };
  env.listeners.clear();
  pending = [];
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init?: RequestInit) =>
        new Promise((resolve) => {
          pending.push({
            url,
            method: init?.method ?? 'GET',
            resolve: (body) => resolve({ ok: true, status: 200, json: async () => body }),
          });
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function answerWith(index: number, body: unknown) {
  await act(async () => {
    pending[index]?.resolve(body);
  });
}

async function answer(index: number, count: number) {
  await answerWith(index, Array.from({ length: count }, (_, i) => ({ _id: `r${i}`, code: String(i) })));
}

// A signs in with a request in flight, signs out, B signs in and loads `bItems`.
async function switchAccountTo(bItems: unknown[], bLoadIndex: number) {
  window.localStorage.removeItem('token');
  setAuth(resolvedAs(null));
  window.localStorage.setItem('token', 'token-b');
  setAuth(resolvedAs('user-b'));
  expect(pending[bLoadIndex]?.method).toBe('GET');
  await answerWith(bLoadIndex, bItems);
}

describe.each(providers)('%s', (_name, url, Provider, Probe) => {
  const renderProvider = () =>
    render(
      <Provider>
        <Probe />
      </Provider>,
    );

  it('fetches at once when a token exists, in parallel with auth, and not again for that user', async () => {
    window.localStorage.setItem('token', 'token-a');
    renderProvider();

    // auth has not resolved yet, and the request is already out
    expect(pending).toHaveLength(1);
    expect(pending[0]?.url).toBe(url);
    await answer(0, 1);
    expect(screen.getByText('itens 1')).toBeInTheDocument();

    setAuth(resolvedAs('user-a'));
    expect(pending).toHaveLength(1);
  });

  it('fetches again when the user changes', async () => {
    window.localStorage.setItem('token', 'token-a');
    renderProvider();
    await answer(0, 1);
    setAuth(resolvedAs('user-a'));

    window.localStorage.setItem('token', 'token-b');
    setAuth(resolvedAs('user-b'));
    expect(pending).toHaveLength(2);
    await answer(1, 2);
    expect(screen.getByText('itens 2')).toBeInTheDocument();
  });

  it('clears on sign-out', async () => {
    window.localStorage.setItem('token', 'token-a');
    renderProvider();
    await answer(0, 3);
    setAuth(resolvedAs('user-a'));

    window.localStorage.removeItem('token');
    setAuth(resolvedAs(null));
    expect(screen.getByText('itens 0')).toBeInTheDocument();
    expect(pending).toHaveLength(1);
  });

  it('does not fetch without a token', () => {
    renderProvider();
    setAuth(resolvedAs(null));

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText('itens 0')).toBeInTheDocument();
  });

  it('ignores a late response for the previous user', async () => {
    window.localStorage.setItem('token', 'token-a');
    renderProvider();
    setAuth(resolvedAs('user-a'));
    window.localStorage.setItem('token', 'token-b');
    setAuth(resolvedAs('user-b'));
    expect(pending).toHaveLength(2);

    await answer(1, 2);
    await answer(0, 5);
    expect(screen.getByText('itens 2')).toBeInTheDocument();
  });

  it('ignores a response that arrives after sign-out', async () => {
    window.localStorage.setItem('token', 'token-a');
    renderProvider();
    setAuth(resolvedAs(null));

    await answer(0, 4);
    expect(screen.getByText('itens 0')).toBeInTheDocument();
  });
});

// #42: a mutation started by A must not touch B's state after A signs out and B signs in.
describe('mutations across an account change', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    window.localStorage.setItem('token', 'token-a');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function FavoritesActions() {
    const { favorites, toggleFavorite, removeFavorite } = useFavorites();
    return (
      <>
        <p>{`itens ${favorites.length}`}</p>
        <button type="button" onClick={() => toggleFavorite({ code: 'X' } as never)}>
          Favoritar
        </button>
        <button type="button" onClick={() => removeFavorite('0')}>
          Remover
        </button>
      </>
    );
  }

  function RemindersActions() {
    const { reminders, createReminder, updateReminder, deleteReminder } = useReminders();
    return (
      <>
        <p>{`itens ${reminders.length} ${reminders.map((r) => r.description ?? '-').join(',')}`}</p>
        <button
          type="button"
          onClick={() =>
            createReminder({ auctionId: 'a', channel: 'EMAIL', scheduledAt: '2026-11-14T13:00:00Z' })
          }
        >
          Criar
        </button>
        <button type="button" onClick={() => updateReminder('r0', { description: 'de A' })}>
          Editar
        </button>
        <button type="button" onClick={() => deleteReminder('r0')}>
          Apagar
        </button>
      </>
    );
  }

  it("drops A's favourite add once B is signed in", async () => {
    const user = userEvent.setup();
    render(
      <FavoritesProvider>
        <FavoritesActions />
      </FavoritesProvider>,
    );
    await answer(0, 0);
    setAuth(resolvedAs('user-a'));

    await user.click(screen.getByRole('button', { name: 'Favoritar' }));
    expect(pending[1]?.method).toBe('POST');
    await switchAccountTo([], 2);

    await answerWith(1, { code: 'X' });
    expect(screen.getByText('itens 0')).toBeInTheDocument();
  });

  it("drops A's favourite removal once B is signed in", async () => {
    const user = userEvent.setup();
    render(
      <FavoritesProvider>
        <FavoritesActions />
      </FavoritesProvider>,
    );
    await answer(0, 1);
    setAuth(resolvedAs('user-a'));

    await user.click(screen.getByRole('button', { name: 'Remover' }));
    expect(pending[1]?.method).toBe('DELETE');
    // B happens to have the same property saved
    await switchAccountTo([{ code: '0' }], 2);

    await answerWith(1, {});
    expect(screen.getByText('itens 1')).toBeInTheDocument();
  });

  it.each([
    ['Criar', 'POST', { _id: 'r9', description: 'de A' }],
    ['Editar', 'PATCH', { _id: 'r0', description: 'de A' }],
    ['Apagar', 'DELETE', {}],
  ])("drops A's reminder %s once B is signed in", async (button, method, response) => {
    const user = userEvent.setup();
    render(
      <RemindersProvider>
        <RemindersActions />
      </RemindersProvider>,
    );
    await answerWith(0, [{ _id: 'r0', description: 'de A' }]);
    setAuth(resolvedAs('user-a'));

    await user.click(screen.getByRole('button', { name: button }));
    expect(pending[1]?.method).toBe(method);
    // B's own reminder happens to share the id
    await switchAccountTo([{ _id: 'r0', description: 'de B' }], 2);

    await answerWith(1, response);
    expect(screen.getByText('itens 1 de B')).toBeInTheDocument();
  });

  it('still applies a mutation when the account did not change', async () => {
    const user = userEvent.setup();
    render(
      <FavoritesProvider>
        <FavoritesActions />
      </FavoritesProvider>,
    );
    await answer(0, 0);
    setAuth(resolvedAs('user-a'));

    await user.click(screen.getByRole('button', { name: 'Favoritar' }));
    await answerWith(1, { code: 'X' });
    expect(screen.getByText('itens 1')).toBeInTheDocument();
  });
});
