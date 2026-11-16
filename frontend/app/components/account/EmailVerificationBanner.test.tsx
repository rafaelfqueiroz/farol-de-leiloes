import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders } from '@/test/render';
import EmailVerificationBanner from './EmailVerificationBanner';

// TS-19: real theme (light and dark), real pt-BR catalogue, axe. Only the auth context is faked.
const env = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  resend: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => env.auth }));

function signIn(emailVerified: boolean | undefined) {
  env.auth = {
    user: { _id: 'u1', email: 'ana@exemplo.test', name: 'Ana', emailVerified },
    resendVerificationEmail: env.resend,
    refreshUser: env.refresh,
  };
}

beforeEach(() => {
  env.resend.mockReset();
  env.refresh.mockReset();
  signIn(false);
});

const UNCONFIRMED = 'Confirme seu e-mail para usar favoritos, filtros, lembretes e a calculadora.';

describe('EmailVerificationBanner', () => {
  it.each(['light', 'dark'] as const)(
    'frame 5: warns an unconfirmed account and offers "Reenviar link" (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<EmailVerificationBanner />, { scheme });

      expect(screen.getByRole('status')).toHaveTextContent(UNCONFIRMED);
      expect(screen.getByRole('button', { name: 'Reenviar link' })).toBeEnabled();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('shows nothing to a confirmed account, a guest or a user without the flag', () => {
    signIn(true);
    const confirmed = renderWithProviders(<EmailVerificationBanner />);
    expect(confirmed.container).toBeEmptyDOMElement();
    confirmed.unmount();

    env.auth = { user: null, resendVerificationEmail: env.resend, refreshUser: env.refresh };
    const guest = renderWithProviders(<EmailVerificationBanner />);
    expect(guest.container).toBeEmptyDOMElement();
    guest.unmount();

    signIn(undefined);
    const unknown = renderWithProviders(<EmailVerificationBanner />);
    expect(unknown.container).toBeEmptyDOMElement();
  });

  it('frame 5.3: after resending it says where the link went and drops the action', async () => {
    env.resend.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { container } = renderWithProviders(<EmailVerificationBanner />);

    await user.click(screen.getByRole('button', { name: 'Reenviar link' }));

    expect(await screen.findByText('Enviamos um novo link para ana@exemplo.test.')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(env.resend).toHaveBeenCalledTimes(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('disables the action while the link is being sent', async () => {
    env.resend.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderWithProviders(<EmailVerificationBanner />);

    await user.click(screen.getByRole('button', { name: 'Reenviar link' }));

    expect(await screen.findByRole('button', { name: 'Enviando…' })).toBeDisabled();
  });

  it('shows the catalogue text of a throttled resend in the same banner and lets the person retry', async () => {
    env.resend.mockRejectedValueOnce(new ApiError('TOO_MANY_REQUESTS', {}, 429));
    env.resend.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    const { container } = renderWithProviders(<EmailVerificationBanner />);

    await user.click(screen.getByRole('button', { name: 'Reenviar link' }));

    expect(await screen.findByRole('status')).toHaveTextContent(messages.errors.TOO_MANY_REQUESTS);
    expect(screen.queryByText(UNCONFIRMED)).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Reenviar link' }));
    expect(await screen.findByText(/^Enviamos um novo link/)).toBeVisible();
  });

  it('EMAIL_ALREADY_VERIFIED refreshes the account instead of showing an error, and the banner goes with the flag', async () => {
    env.resend.mockRejectedValue(new ApiError('EMAIL_ALREADY_VERIFIED', {}, 409));
    env.refresh.mockImplementation(async () => signIn(true));
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<EmailVerificationBanner />);

    await user.click(screen.getByRole('button', { name: 'Reenviar link' }));

    await waitFor(() => expect(env.refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(messages.errors.EMAIL_ALREADY_VERIFIED)).not.toBeInTheDocument();
    rerender(<EmailVerificationBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('starts clean for another account', () => {
    const { rerender } = renderWithProviders(<EmailVerificationBanner />);
    env.auth = {
      user: { _id: 'u2', email: 'bia@exemplo.test', name: 'Bia', emailVerified: false },
      resendVerificationEmail: env.resend,
      refreshUser: env.refresh,
    };
    rerender(<EmailVerificationBanner />);

    expect(screen.getByRole('status')).toHaveTextContent(UNCONFIRMED);
  });
});
