import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_LEGAL, currentLegalResponse } from '@/test/legal-fixtures';
import { axe, renderWithProviders as render } from '@/test/render';
import TermsReacceptanceDialog from './TermsReacceptanceDialog';

const env = vi.hoisted(() => ({
  logout: vi.fn(),
  refreshUser: vi.fn(),
  replace: vi.fn(),
  report: vi.fn(),
  documents: [] as { type: string; version: string }[],
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: env.replace }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/app/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { documents: env.documents, termsAcceptanceRequired: true },
    logout: env.logout,
    refreshUser: env.refreshUser,
  }),
}));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const acceptAnswer = vi.fn<() => Promise<Response>>();

beforeEach(() => {
  env.logout.mockReset().mockResolvedValue(undefined);
  env.refreshUser.mockReset().mockResolvedValue(undefined);
  env.replace.mockReset();
  env.report.mockReset();
  env.documents = [];
  acceptAnswer.mockReset().mockResolvedValue(json({ items: [] }));
  fetchMock
    .mockReset()
    .mockImplementation((url: string) =>
      url === '/api/legal/current' ? Promise.resolve(currentLegalResponse()) : acceptAnswer(),
    );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const ACK = 'Li e aceito as novas versões.';
const accept = () => screen.getByRole('button', { name: /^(Aceitar e continuar|Registrando)$/ });
const legalCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/legal/current').length;

async function open() {
  const result = render(<TermsReacceptanceDialog />);
  await screen.findByText(/Termos de uso, versão 0.2/);
  return result;
}

// TS-19: real theme, real catalogue, axe. BR-010-05.
describe('TermsReacceptanceDialog', () => {
  it.each(['light', 'dark'] as const)(
    'is a labelled modal dialog that lists the new versions with their links and day in force, and passes axe (%s)',
    async (scheme) => {
      render(<TermsReacceptanceDialog />, { scheme });
      await screen.findByText(/Termos de uso, versão 0.2/);

      const dialog = screen.getByRole('dialog', { name: 'Novos termos e política de privacidade' });
      expect(dialog).toHaveAccessibleDescription(
        'Atualizamos os documentos abaixo. Para continuar usando sua conta, leia as novas versões e aceite.',
      );
      const terms = within(dialog).getByRole('link', { name: 'Termos de uso, versão 0.2' });
      expect(terms).toHaveAttribute('href', '/termos');
      expect(terms).toHaveAttribute('target', '_blank');
      expect(
        within(dialog).getByRole('link', { name: 'Política de privacidade, versão 0.2' }),
      ).toHaveAttribute('href', '/privacidade');
      expect(dialog).toHaveTextContent('(em vigor desde 19/11/2026)');
      expect(within(dialog).getByRole('checkbox', { name: ACK })).not.toBeChecked();
      expect(await axe(document.body)).toHaveNoViolations();
    },
  );

  it('offers the rights page and the way out without accepting', async () => {
    await open();

    expect(
      screen.getByRole('link', { name: 'ver meus dados, exportar ou excluir a conta' }),
    ).toHaveAttribute('href', '/profile/privacidade');
    expect(screen.getByRole('button', { name: 'Sair da conta' })).toBeEnabled();
  });

  it('keeps "Aceitar e continuar" off until the box is ticked, and the box off until the versions are known', async () => {
    const user = userEvent.setup();
    render(<TermsReacceptanceDialog />);
    expect(screen.getByRole('checkbox', { name: ACK })).toBeDisabled();
    await screen.findByText(/Termos de uso, versão 0.2/);

    expect(accept()).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: ACK }));
    expect(accept()).toBeEnabled();
  });

  it('cannot be dismissed with Esc or a click outside, and keeps focus inside', async () => {
    const user = userEvent.setup();
    await open();

    await user.keyboard('{Escape}');
    const backdrop = document.querySelector('.MuiBackdrop-root');
    if (!backdrop) throw new Error('no backdrop');
    await user.click(backdrop);
    await user.tab();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeVisible();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('BR-010-05: accepts the versions it listed, refreshes the account and retries nothing', async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByRole('checkbox', { name: ACK }));
    await user.click(accept());

    await waitFor(() => expect(env.refreshUser).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/privacy/accept');
    expect(JSON.parse(String(call?.[1].body))).toEqual({
      termsVersion: CURRENT_LEGAL.terms.version,
      privacyVersion: CURRENT_LEGAL.privacy.version,
    });
    expect(call?.[1].method).toBe('POST');
    // only the legal read and the acceptance: nothing the person did before is repeated
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows "Registrando" and locks every action while the acceptance is being recorded', async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => undefined;
    acceptAnswer.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    await open();
    await user.click(screen.getByRole('checkbox', { name: ACK }));

    await user.click(accept());

    expect(screen.getByRole('button', { name: 'Registrando' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Sair da conta' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: ACK })).toBeDisabled();
    release(json({ items: [] }));
    await waitFor(() => expect(env.refreshUser).toHaveBeenCalled());
  });

  it('TERMS_VERSION_OUTDATED: says a newer version came out, reads again, clears the box and keeps the dialog', async () => {
    const user = userEvent.setup();
    acceptAnswer.mockResolvedValue(json({ code: 'TERMS_VERSION_OUTDATED', context: {} }, 409));
    await open();
    await user.click(screen.getByRole('checkbox', { name: ACK }));

    await user.click(accept());

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saiu uma versão ainda mais nova enquanto você lia. Leia e aceite de novo.',
    );
    await waitFor(() => expect(legalCalls()).toBe(2));
    expect(screen.getByRole('checkbox', { name: ACK })).not.toBeChecked();
    expect(accept()).toBeDisabled();
    expect(env.refreshUser).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('any other failure is an alert inside the dialog, the box stays ticked and the person can try again', async () => {
    const user = userEvent.setup();
    acceptAnswer.mockResolvedValue(json({ code: 'TOO_MANY_REQUESTS', context: {} }, 429));
    await open();
    await user.click(screen.getByRole('checkbox', { name: ACK }));

    await user.click(accept());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas solicitações em pouco tempo',
    );
    expect(screen.getByRole('checkbox', { name: ACK })).toBeChecked();
    expect(accept()).toBeEnabled();
  });

  it('a network failure is reported and shown in the dialog', async () => {
    const user = userEvent.setup();
    const failure = new TypeError('Failed to fetch');
    acceptAnswer.mockRejectedValue(failure);
    await open();
    await user.click(screen.getByRole('checkbox', { name: ACK }));

    await user.click(accept());

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(env.report).toHaveBeenCalledWith(failure, { where: 'TermsReacceptanceDialog' });
  });

  it('lists only the documents still pending when /api/auth/me names them', async () => {
    env.documents = [{ type: 'privacy', version: '0.2' }];
    render(<TermsReacceptanceDialog />);
    await screen.findByText(/Política de privacidade, versão 0.2/);

    expect(screen.queryByText(/Termos de uso, versão/)).not.toBeInTheDocument();
  });

  it('says the versions could not be loaded and retries; nothing can be accepted meanwhile', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(json({ code: 'BACKEND_UNAVAILABLE', context: {} }, 502)),
    );
    render(<TermsReacceptanceDialog />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as novas versões.',
    );
    expect(accept()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await screen.findByText(/Termos de uso, versão 0.2/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('"Sair da conta" signs out and goes to the login', async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByRole('button', { name: 'Sair da conta' }));

    await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/login'));
    expect(env.logout).toHaveBeenCalledTimes(1);
  });
});
