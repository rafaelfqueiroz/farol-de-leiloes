import { act, render, screen } from '@testing-library/react';
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
  resolve: (items: unknown[]) => void;
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
      (url: string) =>
        new Promise((resolve) => {
          pending.push({
            url,
            resolve: (items) => resolve({ ok: true, status: 200, json: async () => items }),
          });
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function answer(index: number, count: number) {
  await act(async () => {
    pending[index]?.resolve(Array.from({ length: count }, (_, i) => ({ code: String(i) })));
  });
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
