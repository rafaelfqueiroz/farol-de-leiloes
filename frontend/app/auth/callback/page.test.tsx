import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { CURRENT_LEGAL, currentLegalResponse } from '@/test/legal-fixtures';
import { axe, renderWithProviders as render } from '@/test/render';
import AuthCallbackPage from './page';

// SPEC-001 BR-001-20: the landing of the Google sign-in. The backend redirects here with a one-time
// `?code=`, never a session; the page trades it through the BFF, the BFF keeps the session in a cookie, loads
// the account and goes home. A first Google sign-in asks for the terms (frame 4); a failure is the
// error screen of frame 4.3, except Google's unverified e-mail, which goes back to the login.
const env = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  loadUser: vi.fn(),
  report: vi.fn(),
  fetch: vi.fn(),
  search: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: env.push, replace: env.replace }),
  useSearchParams: () => new URLSearchParams(env.search),
}));
vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => ({ loadUser: env.loadUser }) }));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  env.push.mockReset();
  env.replace.mockReset();
  env.loadUser.mockReset().mockResolvedValue(undefined);
  env.report.mockReset();
  env.fetch.mockReset();
  vi.stubGlobal('fetch', env.fetch);
  env.search = '';
  window.history.replaceState(null, '', '/auth/callback');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('AuthCallbackPage', () => {
  it('shows a spinner with a hidden h1 and sends a visitor without code to the sign-in', async () => {
    const { container } = render(<AuthCallbackPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: messages.authCallback.authenticating }),
    ).toBeInTheDocument();
    await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/login'));
    expect(env.fetch).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says it is authenticating', () => {
    env.search = 'code=abc';
    env.fetch.mockReturnValue(new Promise(() => undefined));
    render(<AuthCallbackPage />);

    expect(screen.getByText('Entrando…')).toBeInTheDocument();
  });

  it('trades the code for the session (a cookie the BFF sets), loads the user and goes home', async () => {
    env.search = 'code=abc123';
    env.fetch.mockResolvedValue(json({ status: 'signed_in', user: {} }));
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/'));
    expect(env.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = env.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/google/exchange');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ code: 'abc123' }));
    // SC-02: the answer carries no token and the page keeps none anywhere
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(init.credentials).toBe('same-origin');
    expect(env.loadUser).toHaveBeenCalledTimes(1);
  });

  it('BR-001-20: ignores a token in the URL; only a code is read', async () => {
    env.search = 'token=jwt-from-url';
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/login'));
    expect(window.localStorage.length).toBe(0);
    expect(env.fetch).not.toHaveBeenCalled();
  });

  it('frame 4.3: a refused code shows the error screen and stores nothing', async () => {
    env.search = 'code=old';
    env.fetch.mockResolvedValue(json({ code: 'INVALID_GOOGLE_CODE', context: {} }, 400));
    const { container } = render(<AuthCallbackPage />);

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Não foi possível entrar com o Google',
      }),
    ).toBeVisible();
    expect(screen.getByText('Tente de novo ou entre com e-mail e senha.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Voltar para o login' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(window.localStorage.length).toBe(0);
    expect(env.loadUser).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('frame 2.4: an unverified Google e-mail goes back to the login with its code', async () => {
    env.search = 'code=old';
    env.fetch.mockResolvedValue(json({ code: 'GOOGLE_EMAIL_NOT_VERIFIED', context: {} }, 400));
    render(<AuthCallbackPage />);

    await waitFor(() =>
      expect(env.replace).toHaveBeenCalledWith('/login?error=GOOGLE_EMAIL_NOT_VERIFIED'),
    );
  });

  describe('a first Google sign-in (terms_required, SPEC-010 frame "Aceite do Google")', () => {
    async function arrive(extra: Record<string, Response | Error> = {}) {
      env.search = 'code=new-person';
      env.fetch.mockImplementation((url: string) => {
        const answer = extra[url];
        if (answer instanceof Error) return Promise.reject(answer);
        if (answer) return Promise.resolve(answer);
        if (url === '/api/legal/current') return Promise.resolve(currentLegalResponse());
        return Promise.resolve(
          url === '/api/auth/google/exchange'
            ? json({ status: 'terms_required', email: 'ana@example.test', name: 'Ana Souza' })
            : json({ user: {} }),
        );
      });
      const result = render(<AuthCallbackPage />);
      await screen.findByRole('heading', { level: 1, name: 'Quase lá' });
      // the versions in force are what the person is shown and what is sent
      await screen.findByText(/Versões vigentes: termos 0.2 e política 0.2 \(rascunho\)/);
      return result;
    }

    const urls = () => (env.fetch.mock.calls as [string, RequestInit][]).map(([url]) => url);
    const TERMS = 'Li e aceito os Termos de uso e a Política de privacidade.';
    const WHATSAPP = 'Quero receber avisos por WhatsApp (opcional).';
    const callTo = (path: string) =>
      (env.fetch.mock.calls as [string, RequestInit][]).find(([url]) => url === path);

    it.each(['light', 'dark'] as const)(
      'greets with the Google name and e-mail, offers the terms and the optional unticked WhatsApp box, and passes axe (%s)',
      async (scheme) => {
        env.search = 'code=new-person';
        env.fetch.mockImplementation((url: string) =>
          Promise.resolve(
            url === '/api/legal/current'
              ? currentLegalResponse()
              : json({ status: 'terms_required', email: 'ana@example.test', name: 'Ana Souza' }),
          ),
        );
        const { container } = render(<AuthCallbackPage />, { scheme });
        await screen.findByRole('heading', { level: 1, name: 'Quase lá' });
        await screen.findByText(/Versões vigentes/);

        expect(screen.getByText('Ana Souza')).toBeVisible();
        expect(container).toHaveTextContent(
          'Você entrou com o Google como Ana Souza (ana@example.test). Sua conta só é criada depois de aceitar os documentos abaixo.',
        );
        expect(screen.getByRole('checkbox', { name: TERMS })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: WHATSAPP })).not.toBeChecked();
        const block = within(screen.getByRole('group', { name: 'Termos e privacidade' }));
        expect(block.getByRole('link', { name: 'Termos de uso' })).toHaveAttribute(
          'href',
          '/termos',
        );
        expect(block.getByRole('link', { name: 'Política de privacidade' })).toHaveAttribute(
          'href',
          '/privacidade',
        );
        // the legal footer ends the page too (BR-010-02)
        expect(screen.getByRole('contentinfo')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Aceitar e criar conta' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Recusar e cancelar' })).toBeEnabled();
        expect(await axe(container)).toHaveNoViolations();
      },
    );

    it('BR-010-01: without the terms ticked it sends nothing and shows the error tied to the box', async () => {
      const user = userEvent.setup();
      await arrive();

      await user.click(screen.getByRole('button', { name: 'Aceitar e criar conta' }));

      expect(screen.getByRole('checkbox', { name: TERMS })).toHaveAccessibleDescription(
        /Aceite os termos e a política para criar a conta/,
      );
      expect(urls()).not.toContain('/api/auth/google/complete');
      expect(env.loadUser).not.toHaveBeenCalled();
    });

    it('BR-010-01, BR-010-27: completes with the saved code, the versions shown and WhatsApp false by default', async () => {
      const user = userEvent.setup();
      await arrive();

      await user.click(screen.getByRole('checkbox', { name: TERMS }));
      await user.click(screen.getByRole('button', { name: 'Aceitar e criar conta' }));

      await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/'));
      const [, init] = callTo('/api/auth/google/complete') ?? [];
      // the code left the URL, so it comes from the page's own state
      expect(JSON.parse(String(init?.body))).toEqual({
        code: 'new-person',
        acceptTerms: true,
        termsVersion: CURRENT_LEGAL.terms.version,
        privacyVersion: CURRENT_LEGAL.privacy.version,
        whatsappConsent: false,
      });
      expect(env.loadUser).toHaveBeenCalledTimes(1);
      expect(window.localStorage.length).toBe(0);
      expect(env.push).not.toHaveBeenCalled();
    });

    it('BR-010-27: sends whatsappConsent true only when the person ticked it', async () => {
      const user = userEvent.setup();
      await arrive();

      await user.click(screen.getByRole('checkbox', { name: TERMS }));
      await user.click(screen.getByRole('checkbox', { name: WHATSAPP }));
      await user.click(screen.getByRole('button', { name: 'Aceitar e criar conta' }));

      await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/'));
      const [, init] = callTo('/api/auth/google/complete') ?? [];
      expect(JSON.parse(String(init?.body))).toMatchObject({ whatsappConsent: true });
    });

    it('BR-010-01: declining cancels the waiting profile and ends on "Cadastro cancelado", storing nothing', async () => {
      const user = userEvent.setup();
      const { container } = await arrive();

      await user.click(screen.getByRole('button', { name: 'Recusar e cancelar' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Cadastro cancelado' }),
      ).toBeVisible();
      expect(container).toHaveTextContent('não criamos nenhuma conta');
      expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/');
      const [, init] = callTo('/api/auth/google/cancel') ?? [];
      expect(init?.body).toBe(JSON.stringify({ code: 'new-person' }));
      expect(urls()).not.toContain('/api/auth/google/complete');
      expect(env.loadUser).not.toHaveBeenCalled();
      expect(env.push).not.toHaveBeenCalled();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('still ends on "Cadastro cancelado", reporting it, when the cancel cannot be reached', async () => {
      const user = userEvent.setup();
      const failure = new TypeError('Failed to fetch');
      await arrive({ '/api/auth/google/cancel': failure });

      await user.click(screen.getByRole('button', { name: 'Recusar e cancelar' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Cadastro cancelado' }),
      ).toBeVisible();
      expect(env.report).toHaveBeenCalledWith(failure, { where: 'auth/callback' });
    });

    it('an expired code at completion says the time to accept ran out and offers Google again', async () => {
      const user = userEvent.setup();
      await arrive({
        '/api/auth/google/complete': json({ code: 'INVALID_GOOGLE_CODE', context: {} }, 400),
      });

      await user.click(screen.getByRole('checkbox', { name: TERMS }));
      await user.click(screen.getByRole('button', { name: 'Aceitar e criar conta' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'O tempo para aceitar acabou' }),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Entrar com o Google' })).toBeEnabled();
      expect(env.loadUser).not.toHaveBeenCalled();
      expect(env.replace).not.toHaveBeenCalled();
    });

    it('BR-010-01: TERMS_VERSION_OUTDATED says the documents changed, reads the new versions and asks again, creating nothing', async () => {
      const user = userEvent.setup();
      await arrive({
        '/api/auth/google/complete': json(
          { code: 'TERMS_VERSION_OUTDATED', context: { documents: [] } },
          409,
        ),
      });

      await user.click(screen.getByRole('checkbox', { name: TERMS }));
      await user.click(screen.getByRole('button', { name: 'Aceitar e criar conta' }));

      const alert = await screen.findByRole('status');
      expect(alert).toHaveTextContent('Os documentos mudaram');
      expect(screen.getByRole('link', { name: 'Ler as novas versões' })).toHaveAttribute(
        'href',
        '/termos',
      );
      expect(screen.getByText('Sua conta continua sem ser criada até você aceitar.')).toBeVisible();
      // the box is cleared so the new text is read before accepting; the page stays on the step
      await waitFor(() => expect(screen.getByRole('checkbox', { name: TERMS })).not.toBeChecked());
      expect(urls().filter((url) => url === '/api/legal/current')).toHaveLength(2);
      expect(env.loadUser).not.toHaveBeenCalled();
      expect(env.replace).not.toHaveBeenCalled();
    });

    it('does not offer to continue when the versions cannot be loaded, and retries them', async () => {
      const user = userEvent.setup();
      env.search = 'code=new-person';
      let legalCalls = 0;
      env.fetch.mockImplementation((url: string) => {
        if (url === '/api/legal/current') {
          legalCalls += 1;
          return Promise.resolve(
            legalCalls === 1
              ? json({ code: 'BACKEND_UNAVAILABLE', context: {} }, 502)
              : currentLegalResponse(),
          );
        }
        return Promise.resolve(json({ status: 'terms_required', email: 'a@b.test' }));
      });
      render(<AuthCallbackPage />);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Não foi possível carregar as versões vigentes dos documentos.',
      );
      expect(screen.getByRole('button', { name: 'Aceitar e criar conta' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
      await screen.findByText(/Versões vigentes/);
      expect(screen.getByRole('button', { name: 'Aceitar e criar conta' })).toBeEnabled();
      // no Google name: the e-mail alone greets
      expect(screen.getByText('a@b.test')).toBeVisible();
    });

    it('frame 4.3: a refused completion shows the error screen', async () => {
      const user = userEvent.setup();
      await arrive({
        '/api/auth/google/complete': json({ code: 'INTERNAL_ERROR', context: {} }, 500),
      });

      await user.click(screen.getByRole('checkbox', { name: TERMS }));
      await user.click(screen.getByRole('button', { name: 'Aceitar e criar conta' }));

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: 'Não foi possível entrar com o Google',
        }),
      ).toBeVisible();
      expect(env.loadUser).not.toHaveBeenCalled();
    });

    it('reports and shows the error screen when completing cannot be reached', async () => {
      const user = userEvent.setup();
      const failure = new TypeError('Failed to fetch');
      await arrive({ '/api/auth/google/complete': failure });

      await user.click(screen.getByRole('checkbox', { name: TERMS }));
      await user.click(screen.getByRole('button', { name: 'Aceitar e criar conta' }));

      expect(await screen.findByRole('link', { name: 'Voltar para o login' })).toBeVisible();
      expect(env.report).toHaveBeenCalledWith(failure, { where: 'auth/callback' });
    });
  });

  it('removes the code from the address bar as soon as it is read, before the exchange answers', async () => {
    window.history.replaceState(null, '', '/auth/callback?code=abc123');
    env.search = 'code=abc123';
    env.fetch.mockReturnValue(new Promise(() => undefined));
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.fetch).toHaveBeenCalledTimes(1));
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/auth/callback');
  });

  it('never pushes a history entry: every redirect replaces the callback', async () => {
    env.search = 'code=abc123';
    env.fetch.mockResolvedValue(json({ status: 'signed_in', user: {} }));
    render(<AuthCallbackPage />);

    await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/'));
    expect(env.push).not.toHaveBeenCalled();
  });

  it('reports the failure and shows the error screen when the exchange cannot be reached', async () => {
    env.search = 'code=abc';
    const failure = new TypeError('Failed to fetch');
    env.fetch.mockRejectedValue(failure);
    render(<AuthCallbackPage />);

    expect(await screen.findByRole('link', { name: 'Voltar para o login' })).toBeVisible();
    expect(env.report).toHaveBeenCalledWith(failure, { where: 'auth/callback' });
  });

  it('reports the failure and shows the error screen when the account cannot be loaded', async () => {
    env.search = 'code=abc';
    env.fetch.mockResolvedValue(json({ status: 'signed_in', user: {} }));
    const failure = new Error('boom');
    env.loadUser.mockRejectedValue(failure);
    render(<AuthCallbackPage />);

    expect(await screen.findByRole('link', { name: 'Voltar para o login' })).toBeVisible();
    expect(env.report).toHaveBeenCalledWith(failure, { where: 'auth/callback' });
    expect(env.replace).not.toHaveBeenCalledWith('/');
  });
});
