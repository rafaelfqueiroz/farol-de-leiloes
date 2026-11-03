import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { renderWithProviders as render } from '@/test/render';
import FavoritesView from './FavoritesView';

// AR-35: the favourites page reads the paginated list, 20 cards at a time, and reloads when the
// favourites change anywhere.
const env = vi.hoisted(() => ({
  favorites: { favoriteCodes: [] as string[], loading: false, toggleFavorite: vi.fn() },
  auth: { isAuthenticated: true, loading: false },
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('../contexts/FavoritesContext', () => ({ useFavorites: () => env.favorites }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => env.auth }));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: vi.fn() }));
vi.mock('./AuctionCard', () => ({
  default: ({ auction }: { auction: { code: string } }) => <p>{`leilão ${auction.code}`}</p>,
}));

type Answer = { status: number; body: unknown };
let answers: Answer[];
let urls: string[];

const auctions = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ code: `A${from + i}` }));

beforeEach(() => {
  answers = [];
  urls = [];
  env.auth = { isAuthenticated: true, loading: false };
  env.favorites = { favoriteCodes: ['A0'], loading: false, toggleFavorite: vi.fn() };
  env.push.mockReset();
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      const answer = answers.shift();
      if (!answer) throw new Error(`unexpected request ${url}`);
      return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FavoritesView', () => {
  it('shows the first page of the paginated list and the total', async () => {
    answers = [{ status: 200, body: { items: auctions(0, 20), total: 45, page: 1, pageSize: 20 } }];
    render(<FavoritesView />);

    expect(await screen.findByText('leilão A0')).toBeInTheDocument();
    expect(urls).toEqual(['/api/favorites?page=1&pageSize=20']);
    expect(screen.getByText(/45 leilões marcados como favoritos/)).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('loads the next page from the pagination control', async () => {
    const user = userEvent.setup();
    answers = [
      { status: 200, body: { items: auctions(0, 20), total: 45, page: 1, pageSize: 20 } },
      { status: 200, body: { items: auctions(20, 20), total: 45, page: 2, pageSize: 20 } },
    ];
    render(<FavoritesView />);
    await screen.findByText('leilão A0');

    await user.click(screen.getByRole('button', { name: /page 2|página 2/i }));

    expect(await screen.findByText('leilão A20')).toBeInTheDocument();
    expect(urls[1]).toBe('/api/favorites?page=2&pageSize=20');
  });

  it('has no pagination for a single page', async () => {
    answers = [{ status: 200, body: { items: auctions(0, 3), total: 3, page: 1, pageSize: 20 } }];
    render(<FavoritesView />);

    await screen.findByText('leilão A0');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('reloads the list when the favourite codes change', async () => {
    answers = [
      { status: 200, body: { items: auctions(0, 2), total: 2, page: 1, pageSize: 20 } },
      { status: 200, body: { items: auctions(0, 1), total: 1, page: 1, pageSize: 20 } },
    ];
    const { rerender } = render(<FavoritesView />);
    await screen.findByText('leilão A1');

    env.favorites = { ...env.favorites, favoriteCodes: ['A0'] };
    await act(async () => {
      rerender(<FavoritesView />);
    });

    await waitFor(() => expect(screen.queryByText('leilão A1')).not.toBeInTheDocument());
    expect(urls).toHaveLength(2);
  });

  it('steps back a page when the page it was on is now empty', async () => {
    const user = userEvent.setup();
    answers = [
      { status: 200, body: { items: auctions(0, 20), total: 21, page: 1, pageSize: 20 } },
      { status: 200, body: { items: auctions(20, 1), total: 21, page: 2, pageSize: 20 } },
      { status: 200, body: { items: [], total: 20, page: 2, pageSize: 20 } },
      { status: 200, body: { items: auctions(0, 20), total: 20, page: 1, pageSize: 20 } },
    ];
    const { rerender } = render(<FavoritesView />);
    await screen.findByText('leilão A0');
    await user.click(screen.getByRole('button', { name: /page 2|página 2/i }));
    await screen.findByText('leilão A20');

    env.favorites = { ...env.favorites, favoriteCodes: [] };
    await act(async () => {
      rerender(<FavoritesView />);
    });

    expect(await screen.findByText('leilão A0')).toBeInTheDocument();
    expect(urls.at(-1)).toBe('/api/favorites?page=1&pageSize=20');
  });

  it('shows the empty state when there are no favourites', async () => {
    answers = [{ status: 200, body: { items: [], total: 0, page: 1, pageSize: 20 } }];
    render(<FavoritesView />);

    expect(await screen.findByText('Nenhum leilão favorito')).toBeInTheDocument();
  });

  it('shows the message of the error code when the list fails (AR-39)', async () => {
    answers = [
      { status: 403, body: { code: 'PLAN_NOT_ALLOWED', context: { requiredRoles: ['standard'] } } },
    ];
    render(<FavoritesView />);

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.PLAN_NOT_ALLOWED);
  });

  it('does not fetch while the favourites context is still loading, or when signed out', async () => {
    env.favorites = { ...env.favorites, loading: true };
    const { unmount } = render(<FavoritesView />);
    unmount();
    env.favorites = { ...env.favorites, loading: false };
    env.auth = { isAuthenticated: false, loading: false };
    render(<FavoritesView />);

    expect(urls).toEqual([]);
    expect(env.push).toHaveBeenCalledWith('/login');
  });
});
