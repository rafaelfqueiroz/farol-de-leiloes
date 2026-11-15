import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import VerifyEmailTokenPage from './page';

// SPEC-001: opening the link of the confirmation email verifies the address on arrival.
const env = vi.hoisted(() => {
  const push = vi.fn();
  // Next's router is a stable object; the page's effect depends on it
  return { push, router: { push }, token: 'tok-abc' as string | undefined };
});
const fetchMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => env.router,
  useParams: () => ({ token: env.token }),
}));
// a plain anchor: jsdom cannot navigate, the page only needs the href
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  env.push.mockReset();
  env.token = 'tok-abc';
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

describe('VerifyEmailTokenPage', () => {
  it('posts the token from the link to the BFF and says it is verifying meanwhile', async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    render(<VerifyEmailTokenPage />);

    expect(screen.getByRole('heading', { name: 'Verificando e-mail...' })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'tok-abc' }),
    });
  });

  it('confirms the verification and offers the login', async () => {
    answer(200, {});
    const { container } = render(<VerifyEmailTokenPage />);

    expect(await screen.findByRole('heading', { name: 'E-mail verificado!' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ir para o login' })).toHaveAttribute('href', '/login');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('goes to the login after three seconds', async () => {
    // TS-06: a fake clock, never a real wait
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answer(200, {});
    render(<VerifyEmailTokenPage />);
    await screen.findByRole('heading', { name: 'E-mail verificado!' });

    // the polling of findByRole already moved the clock a little, so keep a margin
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(env.push).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(env.push).toHaveBeenCalledWith('/login');
  });

  it('shows the catalogue message of the code when the link is invalid or expired', async () => {
    answer(400, { code: 'INVALID_VERIFICATION_TOKEN', context: {} });
    const { container } = render(<VerifyEmailTokenPage />);

    expect(await screen.findByRole('heading', { name: 'Erro na verificação' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(messages.errors.INVALID_VERIFICATION_TOKEN);
    expect(screen.getByRole('link', { name: 'Ir para o login' })).toHaveAttribute('href', '/login');
    expect(env.push).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the generic message when the API cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<VerifyEmailTokenPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.UNKNOWN);
  });

  it('does not call the API when the link carries no token', () => {
    env.token = undefined;
    render(<VerifyEmailTokenPage />);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
