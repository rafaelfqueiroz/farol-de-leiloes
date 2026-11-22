import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import DeleteAccountSection from './DeleteAccountSection';
import { json } from './privacy-test-support';

const env = vi.hoisted(() => ({
  providers: ['local'] as string[],
  replace: vi.fn(),
  report: vi.fn(),
  assign: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: env.replace }) }));
vi.mock('@/app/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { providers: env.providers } }),
}));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));
vi.mock('@/lib/env', () => ({ publicEnv: { apiUrl: 'http://api.example.test' } }));

const fetchMock = vi.fn();

beforeEach(() => {
  env.providers = ['local'];
  env.replace.mockReset();
  env.report.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/profile/privacidade');
});
afterEach(() => vi.unstubAllGlobals());

const OPEN = 'Excluir minha conta';
const DIALOG = 'Excluir sua conta?';
const ACK = 'Entendo que não dá para desfazer.';

async function openDialog() {
  const user = userEvent.setup();
  renderWithProviders(<DeleteAccountSection />);
  await user.click(screen.getByRole('button', { name: OPEN }));
  return { user, dialog: await screen.findByRole('alertdialog', { name: DIALOG }) };
}
const confirmButton = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: /^(Excluir minha conta|Excluindo)$/ });
const body = () => JSON.parse(String(fetchMock.mock.calls[0]?.[1].body));

// TS-19, TS-20. BR-010-13, BR-010-14, DS-27.
describe('DeleteAccountSection', () => {
  it.each(['light', 'dark'] as const)(
    'is the danger zone: what happens, in words, and one button (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<DeleteAccountSection />, { scheme });

      expect(screen.getByRole('heading', { level: 2, name: 'Excluir minha conta' })).toBeVisible();
      expect(container).toHaveTextContent(
        'Encerra a conta agora e apaga seus dados pessoais em até 30 dias.',
      );
      expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'Você sai de todos os aparelhos agora e não consegue entrar de novo.',
        'Você não recebe mais nenhum aviso.',
        'Guardamos só o que a lei manda (por exemplo, registros de cobrança) e o que pertence a um escritório.',
        'Não dá para desfazer. O e-mail fica livre para um novo cadastro depois da exclusão dos dados.',
      ]);
      expect(screen.getByRole('button', { name: OPEN })).toBeEnabled();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  describe('an account with a password', () => {
    it.each(['light', 'dark'] as const)(
      'asks for the current password and the "I understand" box, in an alertdialog (%s)',
      async (scheme) => {
        const user = userEvent.setup();
        renderWithProviders(<DeleteAccountSection />, { scheme });
        await user.click(screen.getByRole('button', { name: OPEN }));

        const dialog = await screen.findByRole('alertdialog', { name: DIALOG });
        expect(dialog).toHaveAccessibleDescription(
          'Isto encerra sua conta agora, para sempre. Seus dados pessoais são apagados em até 30 dias.',
        );
        const field = within(dialog).getByLabelText('Sua senha atual');
        expect(field).toHaveAttribute('type', 'password');
        expect(field).toHaveAttribute('autocomplete', 'current-password');
        expect(within(dialog).getByRole('checkbox', { name: ACK })).not.toBeChecked();
        expect(confirmButton(dialog)).toBeDisabled();
        // the safe action is first and has the focus
        expect(within(dialog).getByRole('button', { name: 'Manter minha conta' })).toHaveFocus();
        expect(await axe(dialog)).toHaveNoViolations();
      },
    );

    it('enables the deletion only with the password and the box, and sends exactly the password and the confirmation', async () => {
      fetchMock.mockResolvedValue(json({ closed: true }));
      const { user, dialog } = await openDialog();

      await user.type(within(dialog).getByLabelText('Sua senha atual'), 'minha-senha');
      expect(confirmButton(dialog)).toBeDisabled();
      await user.click(within(dialog).getByRole('checkbox', { name: ACK }));
      expect(confirmButton(dialog)).toBeEnabled();
      await user.click(confirmButton(dialog));

      await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/conta-encerrada'));
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/privacy/delete-account');
      expect(fetchMock.mock.calls[0]?.[1].method).toBe('POST');
      expect(body()).toEqual({ password: 'minha-senha', confirm: true });
    });

    it('says "Excluindo", locks the dialog and cannot be dismissed while it deletes', async () => {
      let release: (response: Response) => void = () => undefined;
      fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
      const { user, dialog } = await openDialog();
      await user.type(within(dialog).getByLabelText('Sua senha atual'), 'minha-senha');
      await user.click(within(dialog).getByRole('checkbox', { name: ACK }));

      await user.click(confirmButton(dialog));
      await user.keyboard('{Escape}');

      expect(confirmButton(dialog)).toHaveAttribute('aria-busy', 'true');
      expect(confirmButton(dialog)).toHaveAccessibleName('Excluindo');
      expect(within(dialog).getByRole('button', { name: 'Manter minha conta' })).toBeDisabled();
      expect(within(dialog).getByLabelText('Sua senha atual')).toBeDisabled();
      expect(screen.getByRole('alertdialog')).toBeVisible();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      release(json({ closed: true }));
      await waitFor(() => expect(env.replace).toHaveBeenCalled());
    });

    it('a wrong password is a field error, tied to the field, and the dialog stays for another try', async () => {
      fetchMock.mockResolvedValue(json({ code: 'CURRENT_PASSWORD_INCORRECT', context: {} }, 401));
      const { user, dialog } = await openDialog();
      await user.type(within(dialog).getByLabelText('Sua senha atual'), 'errada');
      await user.click(within(dialog).getByRole('checkbox', { name: ACK }));

      await user.click(confirmButton(dialog));

      const field = await within(dialog).findByLabelText('Sua senha atual');
      await waitFor(() => expect(field).toHaveAccessibleDescription('Senha incorreta.'));
      expect(field).toBeInvalid();
      expect(env.replace).not.toHaveBeenCalled();
      expect(confirmButton(dialog)).toBeEnabled();
      expect(await axe(dialog)).toHaveNoViolations();

      await user.type(field, 'x');
      expect(field).toBeValid();
    });

    it('too many attempts is an alert in the dialog, not a field error', async () => {
      fetchMock.mockResolvedValue(json({ code: 'TOO_MANY_ATTEMPTS', context: {} }, 429));
      const { user, dialog } = await openDialog();
      await user.type(within(dialog).getByLabelText('Sua senha atual'), 'x');
      await user.click(within(dialog).getByRole('checkbox', { name: ACK }));

      await user.click(confirmButton(dialog));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Muitas tentativas');
      expect(within(dialog).getByLabelText('Sua senha atual')).toBeValid();
      expect(await axe(dialog)).toHaveNoViolations();
    });

    it('REAUTHENTICATION_UNAVAILABLE and any other refusal are alerts in the dialog', async () => {
      fetchMock
        .mockResolvedValueOnce(json({ code: 'REAUTHENTICATION_UNAVAILABLE', context: {} }, 409))
        .mockResolvedValueOnce(json({ code: 'INTERNAL_ERROR', context: {} }, 500));
      const { user, dialog } = await openDialog();
      await user.type(within(dialog).getByLabelText('Sua senha atual'), 'x');
      await user.click(within(dialog).getByRole('checkbox', { name: ACK }));

      await user.click(confirmButton(dialog));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Não há senha nem conta Google para confirmar a sua identidade.',
      );
      await user.click(confirmButton(dialog));
      await waitFor(() =>
        expect(within(dialog).getByRole('alert')).not.toHaveTextContent(
          'Não há senha nem conta Google',
        ),
      );
    });

    it('a network failure is reported and shown, and the dialog stays', async () => {
      const failure = new TypeError('Failed to fetch');
      fetchMock.mockRejectedValue(failure);
      const { user, dialog } = await openDialog();
      await user.type(within(dialog).getByLabelText('Sua senha atual'), 'x');
      await user.click(within(dialog).getByRole('checkbox', { name: ACK }));

      await user.click(confirmButton(dialog));

      expect(await within(dialog).findByRole('alert')).toBeVisible();
      expect(env.report).toHaveBeenCalledWith(failure, { where: 'DeleteAccountSection' });
      expect(env.replace).not.toHaveBeenCalled();
    });

    it('"Manter minha conta" closes the dialog and forgets what was typed, without any request', async () => {
      const { user, dialog } = await openDialog();
      await user.type(within(dialog).getByLabelText('Sua senha atual'), 'segredo');
      await user.click(within(dialog).getByRole('checkbox', { name: ACK }));

      await user.click(within(dialog).getByRole('button', { name: 'Manter minha conta' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: OPEN }));

      const reopened = await screen.findByRole('alertdialog', { name: DIALOG });
      expect(within(reopened).getByLabelText('Sua senha atual')).toHaveValue('');
      expect(within(reopened).getByRole('checkbox', { name: ACK })).not.toBeChecked();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('an account that signs in only with Google (BR-010-13)', () => {
    beforeEach(() => {
      env.providers = ['google'];
    });

    it.each(['light', 'dark'] as const)(
      'offers a new Google sign-in instead of a password, and starts it with the reauth intent (%s)',
      async (scheme) => {
        const assign = vi.fn();
        const original = window.location;
        Object.defineProperty(window, 'location', {
          value: { ...original, assign },
          writable: true,
        });
        const user = userEvent.setup();
        renderWithProviders(<DeleteAccountSection />, { scheme });
        await user.click(screen.getByRole('button', { name: OPEN }));
        const dialog = await screen.findByRole('alertdialog', { name: DIALOG });

        expect(within(dialog).queryByLabelText('Sua senha atual')).not.toBeInTheDocument();
        expect(within(dialog).getByText(/Sua conta entra só com o Google/)).toBeVisible();
        expect(confirmButton(dialog)).toBeDisabled();
        expect(await axe(dialog)).toHaveNoViolations();
        await user.click(within(dialog).getByRole('button', { name: 'Confirmar com o Google' }));

        expect(assign).toHaveBeenCalledWith(
          'http://api.example.test/api/auth/google?intent=reauth',
        );
        Object.defineProperty(window, 'location', { value: original, writable: true });
      },
    );

    it('coming back with the code: reopens the dialog, takes the code out of the address, and deletes with it', async () => {
      window.history.replaceState(null, '', '/profile/privacidade?reauth=one-time-code');
      fetchMock.mockResolvedValue(json({ closed: true }));
      const user = userEvent.setup();
      renderWithProviders(<DeleteAccountSection />);

      const dialog = await screen.findByRole('alertdialog', { name: DIALOG });
      // the code is a credential: gone from the address and from the history entry at once
      expect(window.location.search).toBe('');
      expect(window.location.href).not.toContain('one-time-code');
      expect(within(dialog).getByRole('status')).toHaveTextContent(
        'Confirmado há instantes. Você já pode excluir.',
      );
      expect(document.body.innerHTML).not.toContain('one-time-code');
      expect(confirmButton(dialog)).toBeDisabled();

      await user.click(within(dialog).getByRole('checkbox', { name: ACK }));
      await user.click(confirmButton(dialog));

      await waitFor(() => expect(env.replace).toHaveBeenCalledWith('/conta-encerrada'));
      expect(body()).toEqual({ googleCode: 'one-time-code', confirm: true });
      expect(JSON.stringify(body())).not.toContain('password');
    });

    it('a code that is no longer valid (single use, 60 seconds) is dropped, said, and Google is asked again', async () => {
      window.history.replaceState(null, '', '/profile/privacidade?reauth=stale');
      fetchMock.mockResolvedValue(json({ code: 'INVALID_GOOGLE_CODE', context: {} }, 400));
      const user = userEvent.setup();
      renderWithProviders(<DeleteAccountSection />);
      const dialog = await screen.findByRole('alertdialog', { name: DIALOG });
      await user.click(within(dialog).getByRole('checkbox', { name: ACK }));

      await user.click(confirmButton(dialog));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'A confirmação do Google expirou. Confirme de novo.',
      );
      expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
      expect(confirmButton(dialog)).toBeDisabled();
      expect(within(dialog).getByRole('button', { name: 'Confirmar com o Google' })).toBeEnabled();
    });

    it('coming back from a refused re-authentication reopens the dialog with the reason and no code', async () => {
      window.history.replaceState(
        null,
        '',
        '/profile/privacidade?reauthError=GOOGLE_SIGN_IN_FAILED',
      );
      renderWithProviders(<DeleteAccountSection />);

      const dialog = await screen.findByRole('alertdialog', { name: DIALOG });
      expect(window.location.search).toBe('');
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Não foi possível entrar com o Google',
      );
      expect(confirmButton(dialog)).toBeDisabled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('an empty code is no confirmation', async () => {
      window.history.replaceState(null, '', '/profile/privacidade?reauth=');
      renderWithProviders(<DeleteAccountSection />);

      const dialog = await screen.findByRole('alertdialog', { name: DIALOG });
      expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
    });
  });

  it('opens nothing by itself on an ordinary visit, and leaves the address alone', () => {
    window.history.replaceState(null, '', '/profile/privacidade?x=1');
    renderWithProviders(<DeleteAccountSection />);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?x=1');
  });

  it('an account with no password and no Google cannot confirm: the deletion stays off', async () => {
    env.providers = [];
    const user = userEvent.setup();
    renderWithProviders(<DeleteAccountSection />);
    await user.click(screen.getByRole('button', { name: OPEN }));

    const dialog = await screen.findByRole('alertdialog', { name: DIALOG });
    await user.click(within(dialog).getByRole('checkbox', { name: ACK }));

    expect(confirmButton(dialog)).toBeDisabled();
  });
});
