import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders as render } from '@/test/render';
import WhatsappPromptDialog from './WhatsappPromptDialog';

const env = vi.hoisted(() => ({
  refreshUser: vi.fn(),
  logout: vi.fn(),
  replace: vi.fn(),
  report: vi.fn(),
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
  useAuth: () => ({ refreshUser: env.refreshUser, logout: env.logout }),
}));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  env.refreshUser.mockReset().mockResolvedValue(undefined);
  env.logout.mockReset().mockResolvedValue(undefined);
  env.replace.mockReset();
  env.report.mockReset();
  fetchMock.mockReset().mockResolvedValue(json({ state: 'granted', at: null, textVersion: '1' }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const body = () => JSON.parse(String(fetchMock.mock.calls[0]?.[1].body));

// TS-19. BR-010-27: asked once, after the documents; "Agora não" is an answer.
describe('WhatsappPromptDialog', () => {
  it.each(['light', 'dark'] as const)(
    'is a labelled dialog with the question and its note, passing axe (%s)',
    async (scheme) => {
      render(<WhatsappPromptDialog />, { scheme });

      const dialog = screen.getByRole('dialog', { name: 'Avisos por WhatsApp' });
      expect(dialog).toHaveAccessibleDescription(
        /Perguntamos uma única vez.*Dizer sim não liga nenhum aviso por si só/,
      );
      expect(screen.getByRole('button', { name: 'Agora não' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Aceito receber' })).toBeEnabled();
      expect(await axe(document.body)).toHaveNoViolations();
    },
  );

  it('"Aceito receber" records granted, by the existing-account prompt, and refreshes the account', async () => {
    const user = userEvent.setup();
    render(<WhatsappPromptDialog />);

    await user.click(screen.getByRole('button', { name: 'Aceito receber' }));

    await waitFor(() => expect(env.refreshUser).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/privacy/whatsapp-consent');
    expect(body()).toEqual({ action: 'granted', method: 'existing_account_prompt' });
  });

  it('"Agora não" records declined: it is an answer, so the question is not asked again', async () => {
    const user = userEvent.setup();
    render(<WhatsappPromptDialog />);

    await user.click(screen.getByRole('button', { name: 'Agora não' }));

    await waitFor(() => expect(env.refreshUser).toHaveBeenCalledTimes(1));
    expect(body()).toEqual({ action: 'declined', method: 'existing_account_prompt' });
  });

  it('Esc means "Agora não"', async () => {
    const user = userEvent.setup();
    render(<WhatsappPromptDialog />);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(env.refreshUser).toHaveBeenCalledTimes(1));
    expect(body()).toEqual({ action: 'declined', method: 'existing_account_prompt' });
  });

  it('a click on the scrim is not an answer', async () => {
    const user = userEvent.setup();
    render(<WhatsappPromptDialog />);
    const backdrop = document.querySelector('.MuiBackdrop-root');
    if (!backdrop) throw new Error('no backdrop');

    await user.click(backdrop);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('shows "Salvando" and locks both answers while saving, and sends one request only', async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    render(<WhatsappPromptDialog />);

    await user.click(screen.getByRole('button', { name: 'Aceito receber' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: 'Salvando' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Agora não' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(json({}));
    await waitFor(() => expect(env.refreshUser).toHaveBeenCalled());
  });

  it('a refused answer is an alert inside the dialog, which stays open for another try', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(json({ code: 'TOO_MANY_REQUESTS', context: {} }, 429));
    render(<WhatsappPromptDialog />);

    await user.click(screen.getByRole('button', { name: 'Agora não' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas solicitações em pouco tempo',
    );
    expect(screen.getByRole('button', { name: 'Aceito receber' })).toBeEnabled();
    expect(env.refreshUser).not.toHaveBeenCalled();
  });

  it('a network failure is reported and shown in the dialog', async () => {
    const user = userEvent.setup();
    const failure = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(failure);
    render(<WhatsappPromptDialog />);

    await user.click(screen.getByRole('button', { name: 'Aceito receber' }));

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(env.report).toHaveBeenCalledWith(failure, { where: 'WhatsappPromptDialog' });
  });

  it('is never a trap: while the answer keeps failing the dialog stays, says so, and the person can sign out or go to their rights', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ code: 'TOO_MANY_REQUESTS', context: {} }, 429)),
    );
    render(<WhatsappPromptDialog />);

    await user.click(screen.getByRole('button', { name: 'Agora não' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Aceito receber' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas solicitações em pouco tempo',
    );
    expect(screen.getByRole('dialog', { name: 'Avisos por WhatsApp' })).toBeVisible();
    expect(env.refreshUser).not.toHaveBeenCalled();
    // the rights page is one click away ...
    expect(
      screen.getByRole('link', { name: 'ver meus dados, exportar ou excluir a conta' }),
    ).toHaveAttribute('href', '/profile/privacidade');
    // ... and so is the way out
    await user.click(screen.getByRole('button', { name: 'Sair da conta' }));
    await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/login'));
    expect(env.logout).toHaveBeenCalledTimes(1);
  });

  it('locks "Sair da conta" with the other actions while an answer is being saved', async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    render(<WhatsappPromptDialog />);

    await user.click(screen.getByRole('button', { name: 'Aceito receber' }));

    expect(screen.getByRole('button', { name: 'Sair da conta' })).toBeDisabled();
    release(json({}));
    await waitFor(() => expect(env.refreshUser).toHaveBeenCalled());
  });
});
