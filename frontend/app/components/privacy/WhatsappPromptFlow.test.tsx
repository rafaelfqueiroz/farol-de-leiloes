import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePathname } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountConsentGate from '@/app/components/account/AccountConsentGate';
import { AuthProvider } from '@/app/contexts/AuthContext';
import { renderWithProviders } from '@/test/render';
import PrivacyPage from './PrivacyPage';
import { WHATSAPP_ON, json, privacyFetch } from './privacy-test-support';

// BR-010-27, SC-29: the one-time WhatsApp question is answered ONCE, wherever it is answered. The real
// AuthProvider, the real consent gate, the prompt's rights link and the real privacy page, with only
// the network and the router stubbed. Before the fix the privacy page changed its own snapshot and
// left the shared account state saying "pending", so the prompt came back and a "Agora não" would
// have overwritten the consent just given.
// the router, as a tiny store both the mocked hooks and the test's page read
const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    path: '/search',
    go(path: string) {
      nav.path = path;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => nav.path,
  };
});

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePathname: () => useSyncExternalStore(nav.subscribe, nav.snapshot, nav.snapshot),
    useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        nav.go(String(href));
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: vi.fn() }));

function App() {
  const path = usePathname();
  return (
    <AuthProvider>
      {path === '/profile/privacidade' ? <PrivacyPage /> : <p>página de busca</p>}
      <button type="button" onClick={() => nav.go('/search')}>
        Voltar à busca
      </button>
      <AccountConsentGate />
    </AuthProvider>
  );
}

/** The API's side of it: `/auth/me` reports the question pending until ANY answer was recorded. */
function stubApi({
  consent = 'none',
  postStatus = 200,
}: {
  consent?: string;
  postStatus?: number;
}) {
  const server = { answered: false, posts: [] as unknown[], consent };
  const read = privacyFetch({
    whatsapp: consent === 'granted' ? WHATSAPP_ON : { state: 'none', at: null, textVersion: null },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') {
        return json({
          userId: 'u1',
          email: 'ana@example.test',
          name: 'Ana',
          providers: ['local'],
          emailVerified: true,
          role: 'free',
          isAdmin: false,
          personas: ['searcher'],
          termsAcceptanceRequired: false,
          documents: [],
          whatsappPromptPending: !server.answered,
        });
      }
      if (url === '/api/privacy/whatsapp-consent' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        server.posts.push(body);
        if (postStatus !== 200) return json({ code: 'TOO_MANY_REQUESTS', context: {} }, postStatus);
        server.answered = true;
        return json({
          state: body.action,
          at: '2026-11-22T15:00:00.000Z',
          textVersion: '1',
        });
      }
      return read(url, init);
    }),
  );
  return server;
}

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => nav.go('/search'));

const PROMPT = 'Avisos por WhatsApp';
const RIGHTS = 'ver meus dados, exportar ou excluir a conta';
const SWITCH = 'Receber avisos por WhatsApp';

async function followTheRightsLink(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('link', { name: RIGHTS }));
  await screen.findByRole('switch', { name: SWITCH });
  // the prompt steps aside on the rights page
  expect(screen.queryByRole('dialog', { name: PROMPT })).not.toBeInTheDocument();
}

describe('the one-time WhatsApp question, answered on the privacy page', () => {
  it('granting there answers it: going back to the search does not ask again', async () => {
    const user = userEvent.setup();
    const server = stubApi({});
    renderWithProviders(<App />);
    expect(await screen.findByRole('dialog', { name: PROMPT })).toBeVisible();

    await followTheRightsLink(user);
    await user.click(screen.getByRole('switch', { name: SWITCH }));
    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked());
    await user.click(screen.getByRole('button', { name: 'Voltar à busca' }));

    expect(await screen.findByText('página de busca')).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: PROMPT })).not.toBeInTheDocument(),
    );
    // exactly one answer was recorded: the grant; no "declined" ever overwrote it
    expect(server.posts).toEqual([{ action: 'granted', method: 'privacy_page' }]);
  });

  it('withdrawing there answers it too', async () => {
    const user = userEvent.setup();
    const server = stubApi({ consent: 'granted' });
    renderWithProviders(<App />);
    await screen.findByRole('dialog', { name: PROMPT });

    await followTheRightsLink(user);
    await user.click(screen.getByRole('switch', { name: SWITCH }));
    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).not.toBeChecked());
    await user.click(screen.getByRole('button', { name: 'Voltar à busca' }));

    await screen.findByText('página de busca');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: PROMPT })).not.toBeInTheDocument(),
    );
    expect(server.posts).toEqual([{ action: 'withdrawn', method: 'privacy_page' }]);
  });

  it('a failed answer there leaves the question pending: it is asked again, nothing was recorded', async () => {
    const user = userEvent.setup();
    const server = stubApi({ postStatus: 429 });
    renderWithProviders(<App />);
    await screen.findByRole('dialog', { name: PROMPT });

    await followTheRightsLink(user);
    await user.click(screen.getByRole('switch', { name: SWITCH }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Voltar à busca' }));

    expect(await screen.findByRole('dialog', { name: PROMPT })).toBeVisible();
    expect(server.answered).toBe(false);
  });
});
