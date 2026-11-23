import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import PrivacyPage from './PrivacyPage';
import { QUEUED, READY, WHATSAPP_OFF, json, privacyFetch } from './privacy-test-support';

const env = vi.hoisted(() => ({
  authenticated: true,
  report: vi.fn(),
  refreshUser: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/app/contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: env.authenticated,
    user: { providers: ['local'] },
    refreshUser: env.refreshUser,
  }),
}));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));

const fetchMock = vi.fn();

beforeEach(() => {
  env.authenticated = true;
  env.report.mockReset();
  env.refreshUser.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockImplementation(privacyFetch());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

// TS-19, TS-20. SPEC-010 frame "Privacidade e dados".
describe('PrivacyPage', () => {
  it('DS-19 loading: a status region with skeletons, and the one h1 already there', async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<PrivacyPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Privacidade e dados' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando');
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(['light', 'dark'] as const)(
    'shows the five sections in the order of the frame, the danger zone last (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<PrivacyPage />, { scheme });

      await screen.findByRole('heading', { level: 2, name: 'Aceites' });
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
      ).toEqual([
        'Aceites',
        'Avisos por WhatsApp',
        'Seus dados',
        'Exportar meus dados',
        'Excluir minha conta',
      ]);
      expect(
        screen.getByText(
          'Veja o que aceitou, o que guardamos e exerça seus direitos sobre seus dados.',
        ),
      ).toBeVisible();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('reads what it shows, once each: acceptances, WhatsApp, my data, the newest export and the documents in force', async () => {
    renderWithProviders(<PrivacyPage />);
    await screen.findByRole('heading', { level: 2, name: 'Aceites' });

    expect(urls().sort()).toEqual(
      [
        '/api/legal/current',
        '/api/privacy/acceptances',
        '/api/privacy/exports?page=1&pageSize=1',
        '/api/privacy/my-data',
        '/api/privacy/whatsapp-consent',
      ].sort(),
    );
    // BR-010-04: the version in force that is a draft says so
    expect(within(screen.getByRole('table')).getAllByText('0.2 (rascunho)')).toHaveLength(2);
  });

  it('works without the documents in force: only the draft marker is lost', async () => {
    fetchMock.mockImplementation(
      privacyFetch({}, (url) =>
        url === '/api/legal/current'
          ? json({ code: 'BACKEND_UNAVAILABLE', context: {} }, 502)
          : undefined,
      ),
    );
    renderWithProviders(<PrivacyPage />);

    await screen.findByRole('heading', { level: 2, name: 'Aceites' });
    expect(within(screen.getByRole('table')).getAllByText('0.2')).toHaveLength(2);
  });

  it('shows a queued export as "Preparando seu arquivo" from the first paint', async () => {
    fetchMock.mockImplementation(privacyFetch({ exports: [QUEUED] }));
    renderWithProviders(<PrivacyPage />);

    expect(await screen.findByText('Preparando seu arquivo', { selector: 'strong' })).toBeVisible();
  });

  it('BR-010-11: a listed ready export the server clock has passed is expired from the first paint, with the replacement action', async () => {
    fetchMock.mockImplementation(
      privacyFetch({}, (url) =>
        url.startsWith('/api/privacy/exports?')
          ? new Response(JSON.stringify({ items: [READY] }), {
              status: 200,
              headers: {
                'content-type': 'application/json',
                date: 'Thu, 26 Nov 2026 18:00:00 GMT',
              },
            })
          : undefined,
      ),
    );
    renderWithProviders(<PrivacyPage />);

    expect(await screen.findByText('Arquivo expirado', { selector: 'strong' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pedir nova exportação' })).toBeVisible();
  });

  it('shows the WhatsApp consent that was answered', async () => {
    fetchMock.mockImplementation(privacyFetch({ whatsapp: WHATSAPP_OFF }));
    renderWithProviders(<PrivacyPage />);

    expect(
      await screen.findByRole('switch', { name: 'Receber avisos por WhatsApp' }),
    ).not.toBeChecked();
  });

  it('keeps the new WhatsApp answer when the switch is used, without reading the page again', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(
      privacyFetch({}, (url, init) =>
        url === '/api/privacy/whatsapp-consent' && init?.method === 'POST'
          ? json(WHATSAPP_OFF)
          : undefined,
      ),
    );
    renderWithProviders(<PrivacyPage />);

    await user.click(await screen.findByRole('switch', { name: 'Receber avisos por WhatsApp' }));

    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked());
    expect(urls().filter((url) => url === '/api/privacy/acceptances')).toHaveLength(1);
  });

  it('DS-19 error: says it could not load, in an alert, with a retry that reads everything again', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(json({ code: 'BACKEND_UNAVAILABLE', context: {} }, 502)),
    );
    const { container } = renderWithProviders(<PrivacyPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar suas informações');
    expect(alert).toHaveTextContent('Tente de novo em instantes.');
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(env.report).toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();

    fetchMock.mockImplementation(privacyFetch());
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Aceites' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('an answer that is not the contract is a failed load, never a half-drawn page', async () => {
    fetchMock.mockImplementation(privacyFetch({ acceptances: [{ documentType: 'cookies' }] }));
    renderWithProviders(<PrivacyPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar suas informações',
    );
  });

  it('reads nothing while nobody is signed in', () => {
    env.authenticated = false;
    renderWithProviders(<PrivacyPage />);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
