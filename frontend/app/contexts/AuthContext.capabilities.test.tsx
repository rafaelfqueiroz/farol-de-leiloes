import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BillingBanner from '@/app/components/plans/BillingBanner';
import PlansPage from '@/app/components/plans/PlansPage';
import { CATALOGUE, aSubscription } from '@/app/components/plans/plans-test-support';
import { renderWithProviders as render } from '@/test/render';
import { AuthProvider, useAuth } from './AuthContext';

// Owner review #173 finding 1: password sign-in and registration answer with the profile only (the
// real UserProfileResponseDto has no `personas`), and the provider outlives the client navigation to
// /plans. The pages decide from `personas`, so an office member must have them before they decide.
// Real AuthProvider, real API client, real answer shapes; only `fetch` is stubbed.
vi.mock('next/navigation', () => ({ usePathname: () => '/plans' }));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: vi.fn() }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** What the BFF gives the browser after POST /api/auth/login: the profile, no token, NO personas. */
const LOGIN_ANSWER = {
  user: {
    _id: '64b7f0000000000000000b01',
    email: 'ana.teste@example.test',
    name: 'Ana Teste',
    providers: ['local'],
    emailVerified: true,
    role: 'free',
    subscriptionStatus: null,
    isAdmin: false,
  },
};
/** What GET /api/auth/me answers (CurrentUserResponseDto): with the personas the server derives. */
const ME_ANSWER = {
  userId: '64b7f0000000000000000b01',
  email: 'ana.teste@example.test',
  name: 'Ana Teste',
  providers: ['local'],
  emailVerified: true,
  role: 'free',
  isAdmin: false,
  personas: ['searcher', 'advisor'],
};

let signedIn = false;
let subscription = aSubscription();
let requests: string[] = [];

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/auth/me') {
        return signedIn ? json(ME_ANSWER) : json({ code: 'UNAUTHENTICATED', context: {} }, 401);
      }
      if (url === '/api/auth/login' || url === '/api/auth/register') {
        signedIn = true;
        return json(LOGIN_ANSWER, 201);
      }
      if (url === '/api/plans') return json(CATALOGUE);
      if (url === '/api/office/subscription') return json(subscription);
      if (url.startsWith('/api/office/subscription/invoices')) {
        return json({ items: [], total: 0, page: 1, pageSize: 6 });
      }
      throw new Error(`unexpected request ${url}`);
    }),
  );
}

function Harness({ via }: { via: 'login' | 'register' }) {
  const { login, register, isAuthenticated } = useAuth();
  const [done, setDone] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void (
            via === 'login'
              ? login('ana.teste@example.test', 'secret1')
              : register('ana.teste@example.test', 'secret1', 'Ana Teste')
          ).then(() => setDone(true))
        }
      >
        entrar
      </button>
      <p>{isAuthenticated && done ? 'signed-in' : 'signed-out'}</p>
      <BillingBanner />
      <PlansPage />
    </>
  );
}

beforeEach(() => {
  signedIn = false;
  subscription = aSubscription();
  requests = [];
  stubApi();
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['login', 'register'] as const)('signing in by %s as an office member', (via) => {
  it('has the personas before the pages decide: the plan page offers to manage, never "Assinar"', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Harness via={via} />
      </AuthProvider>,
    );
    // a visitor first: the catalogue with "Entrar para assinar"
    expect((await screen.findAllByRole('link', { name: 'Entrar para assinar' })).length).toBe(3);

    await user.click(screen.getByRole('button', { name: 'entrar' }));
    await waitFor(() => expect(screen.getByText('signed-in')).toBeVisible());

    const cards = await screen.findAllByRole('article');
    expect(screen.queryByRole('button', { name: 'Assinar' })).not.toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('Plano atual')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Mudar para este plano' })).toHaveLength(2);
    // the capabilities were read from /me after the answer, and the office plan was looked up
    expect(requests).toContain('GET /api/office/subscription');
    expect(requests.filter((r) => r === 'GET /api/auth/me').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the billing notice without a reload', async () => {
    subscription = aSubscription({ status: 'PAST_DUE' });
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Harness via={via} />
      </AuthProvider>,
    );
    await screen.findAllByRole('link', { name: 'Entrar para assinar' });

    await user.click(screen.getByRole('button', { name: 'entrar' }));

    expect(await screen.findByText('O pagamento do plano do escritório falhou')).toBeVisible();
  });
});

describe('signing in when /api/auth/me cannot be read', () => {
  it('still signs in with the profile the answer carried', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/login') return json(LOGIN_ANSWER, 201);
        if (url === '/api/auth/me') {
          if (!signedIn) {
            signedIn = true;
            return json({ code: 'UNAUTHENTICATED', context: {} }, 401);
          }
          throw new TypeError('network');
        }
        throw new Error(`unexpected request ${url}`);
      }),
    );
    function Probe() {
      const { login, user } = useAuth();
      return (
        <>
          <button type="button" onClick={() => void login('a@b.test', 'x')}>
            entrar
          </button>
          <p>{user?.email ?? 'nobody'}</p>
        </>
      );
    }
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('nobody');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'entrar' }));
    });

    expect(await screen.findByText('ana.teste@example.test')).toBeVisible();
  });
});
