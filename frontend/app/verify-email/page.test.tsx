import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import VerifyEmailPage from './page';

// SPEC-001: the holding page of an account that has not confirmed its email yet.
const env = vi.hoisted(() => ({
  push: vi.fn(),
  resend: vi.fn(),
  logout: vi.fn(),
  auth: {} as Record<string, unknown>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => env.auth }));

function setAuth(overrides: Record<string, unknown> = {}) {
  env.auth = {
    user: { email: 'ana@exemplo.test' },
    loading: false,
    isAuthenticated: true,
    emailVerified: false,
    resendVerificationEmail: env.resend,
    logout: env.logout,
    ...overrides,
  };
}

beforeEach(() => {
  env.push.mockReset();
  env.resend.mockReset();
  env.logout.mockReset();
  setAuth();
});

describe('VerifyEmailPage', () => {
  it('names the address the email was sent to and has no accessibility violations', async () => {
    const { container } = render(<VerifyEmailPage />);

    expect(screen.getByRole('heading', { name: 'Verifique seu e-mail' })).toBeVisible();
    expect(screen.getByText('ana@exemplo.test')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows only a spinner while the session is read', () => {
    setAuth({ loading: true });
    render(<VerifyEmailPage />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(env.push).not.toHaveBeenCalled();
  });

  it('sends a visitor to the login', () => {
    setAuth({ isAuthenticated: false, user: null });
    const { container } = render(<VerifyEmailPage />);

    expect(env.push).toHaveBeenCalledWith('/login');
    expect(container).toBeEmptyDOMElement();
  });

  it('sends an already verified account home', () => {
    setAuth({ emailVerified: true });
    const { container } = render(<VerifyEmailPage />);

    expect(env.push).toHaveBeenCalledWith('/');
    expect(container).toBeEmptyDOMElement();
  });

  it('asks for a new email and confirms it was sent', async () => {
    env.resend.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<VerifyEmailPage />);

    await user.click(screen.getByRole('button', { name: 'Reenviar e-mail de verificação' }));

    expect(env.resend).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(messages.verifyEmail.pending.sent)).toBeVisible();
  });

  it('disables the button while the email is being sent', async () => {
    let finish: () => void = () => undefined;
    env.resend.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<VerifyEmailPage />);

    await user.click(screen.getByRole('button', { name: 'Reenviar e-mail de verificação' }));

    expect(screen.getByRole('button', { name: 'Enviando...' })).toBeDisabled();
    finish();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reenviar e-mail de verificação' })).toBeEnabled(),
    );
  });

  it('shows the catalogue message of the code when the resend is refused', async () => {
    env.resend.mockRejectedValue(new ApiError('EMAIL_ALREADY_VERIFIED', {}, 409));
    const user = userEvent.setup();
    render(<VerifyEmailPage />);

    await user.click(screen.getByRole('button', { name: 'Reenviar e-mail de verificação' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.errors.EMAIL_ALREADY_VERIFIED,
    );
    expect(screen.queryByText(messages.verifyEmail.pending.sent)).not.toBeInTheDocument();
  });

  it('signs out and goes to the login', async () => {
    env.logout.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<VerifyEmailPage />);

    await user.click(screen.getByRole('button', { name: 'Sair' }));

    expect(env.logout).toHaveBeenCalledTimes(1);
    expect(env.push).toHaveBeenCalledWith('/login');
  });
});
