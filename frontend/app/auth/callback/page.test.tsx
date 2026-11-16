import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
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

  describe('a first Google sign-in (terms_required, frame 4)', () => {
    async function arrive(extra: Record<string, Response | Error> = {}) {
      env.search = 'code=new-person';
      env.fetch.mockImplementation((url: string) => {
        const answer = extra[url];
        if (answer instanceof Error) return Promise.reject(answer);
        if (answer) return Promise.resolve(answer);
        return Promise.resolve(
          url === '/api/auth/google/exchange'
            ? json({ status: 'terms_required', email: 'ana@example.test', name: 'Ana' })
            : json({ user: {} }),
        );
      });
      const result = render(<AuthCallbackPage />);
      await screen.findByRole('heading', { level: 1, name: 'Falta pouco' });
      return result;
    }

    const urls = () => (env.fetch.mock.calls as [string, RequestInit][]).map(([url]) => url);
    const TERMS = 'Li e aceito os Termos de uso e a Política de privacidade';

    it('frame 4.1: greets with the e-mail, offers the terms, and keeps the button off until ticked', async () => {
      const { container } = await arrive();

      expect(screen.getByText('Entrando como ana@example.test')).toBeVisible();
      expect(screen.getByRole('checkbox', { name: TERMS })).not.toBeChecked();
      expect(screen.getByRole('button', { name: 'Criar conta' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('never completes without the checkbox: the button is off and a forced submit sends nothing', async () => {
      await arrive();

      // the disabled button cannot be clicked; Enter in the form is the other way to submit
      const form = screen.getByRole('button', { name: 'Criar conta' }).closest('form');
      if (!form) throw new Error('the terms screen is a form');
      fireEvent.submit(form);

      expect(screen.getByRole('button', { name: 'Criar conta' })).toBeDisabled();
      expect(urls()).toEqual(['/api/auth/google/exchange']);
      expect(env.loadUser).not.toHaveBeenCalled();
    });

    it('BR-001-09: with the terms accepted it completes with the saved code, loads the user and goes home', async () => {
      const user = userEvent.setup();
      await arrive();

      await user.click(screen.getByRole('checkbox', { name: TERMS }));
      await user.click(screen.getByRole('button', { name: 'Criar conta' }));

      await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/'));
      const calls = env.fetch.mock.calls as [string, RequestInit][];
      expect(calls[1]?.[0]).toBe('/api/auth/google/complete');
      expect(calls[1]?.[1].method).toBe('POST');
      // the code left the URL, so it comes from the page's own state
      expect(calls[1]?.[1].body).toBe(JSON.stringify({ code: 'new-person', acceptTerms: true }));
      expect(env.loadUser).toHaveBeenCalledTimes(1);
      expect(window.localStorage.length).toBe(0);
      expect(env.push).not.toHaveBeenCalled();
    });

    it('BR-010-01: "Cancelar" cancels the waiting profile and replaces the page with the login', async () => {
      const user = userEvent.setup();
      await arrive();

      await user.click(screen.getByRole('button', { name: 'Cancelar' }));

      await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/login'));
      const calls = env.fetch.mock.calls as [string, RequestInit][];
      expect(urls()).toEqual(['/api/auth/google/exchange', '/api/auth/google/cancel']);
      expect(calls[1]?.[1].body).toBe(JSON.stringify({ code: 'new-person' }));
      expect(env.loadUser).not.toHaveBeenCalled();
      expect(env.push).not.toHaveBeenCalled();
    });

    it('still ends on the login, reporting it, when the cancel cannot be reached', async () => {
      const user = userEvent.setup();
      const failure = new TypeError('Failed to fetch');
      await arrive({ '/api/auth/google/cancel': failure });

      await user.click(screen.getByRole('button', { name: 'Cancelar' }));

      await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/login'));
      expect(env.report).toHaveBeenCalledWith(failure, { where: 'auth/callback' });
    });

    it('frame 4.3: a refused or expired code at completion shows the error screen', async () => {
      const user = userEvent.setup();
      await arrive({
        '/api/auth/google/complete': json({ code: 'INVALID_GOOGLE_CODE', context: {} }, 400),
      });

      await user.click(screen.getByRole('checkbox', { name: TERMS }));
      await user.click(screen.getByRole('button', { name: 'Criar conta' }));

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: 'Não foi possível entrar com o Google',
        }),
      ).toBeVisible();
      expect(env.loadUser).not.toHaveBeenCalled();
      expect(env.replace).not.toHaveBeenCalled();
    });

    it('reports and shows the error screen when completing cannot be reached', async () => {
      const user = userEvent.setup();
      const failure = new TypeError('Failed to fetch');
      await arrive({ '/api/auth/google/complete': failure });

      await user.click(screen.getByRole('checkbox', { name: TERMS }));
      await user.click(screen.getByRole('button', { name: 'Criar conta' }));

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
