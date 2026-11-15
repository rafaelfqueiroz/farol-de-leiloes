import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import VerifyEmailPage from './page';

const env = vi.hoisted(() => ({
  push: vi.fn(),
  resend: vi.fn(),
  logout: vi.fn(),
  auth: {} as Record<string, unknown>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => env.auth }));

beforeEach(() => {
  env.push.mockReset();
  env.resend.mockReset().mockResolvedValue(undefined);
  env.logout.mockReset().mockResolvedValue(undefined);
  env.auth = {
    user: { email: 'a@b.com' },
    loading: false,
    isAuthenticated: true,
    emailVerified: false,
    resendVerificationEmail: env.resend,
    logout: env.logout,
  };
});

const t = messages.verifyEmail.pending;

describe('VerifyEmailPage', () => {
  it('has one h1 inside a main and names the e-mail', async () => {
    const { container } = render(<VerifyEmailPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeInTheDocument();
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('resends the e-mail and confirms it', async () => {
    const user = userEvent.setup();
    render(<VerifyEmailPage />);

    await user.click(screen.getByRole('button', { name: t.resend }));

    expect(env.resend).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent(t.sent);
  });

  it('signs out and goes to the sign-in page', async () => {
    const user = userEvent.setup();
    render(<VerifyEmailPage />);

    await user.click(screen.getByRole('button', { name: messages.common.signOut }));

    expect(env.logout).toHaveBeenCalledTimes(1);
    expect(env.push).toHaveBeenCalledWith('/login');
  });

  it('keeps one hidden h1 while the session loads', () => {
    env.auth = { ...env.auth, loading: true };
    render(<VerifyEmailPage />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('sends a signed-out visitor to the sign-in page', () => {
    env.auth = { ...env.auth, isAuthenticated: false };
    render(<VerifyEmailPage />);

    expect(env.push).toHaveBeenCalledWith('/login');
  });
});
