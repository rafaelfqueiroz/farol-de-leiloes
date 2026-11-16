import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import LoginPage from './page';

// AR-39: a failed sign-in shows the pt-BR message of the code the API answered with, never the
// backend's own text and never a hardcoded English fallback.
const env = vi.hoisted(() => ({ login: vi.fn(), push: vi.fn(), authLoading: false }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ login: env.login, loading: env.authLoading }),
}));

beforeEach(() => {
  env.login.mockReset();
  env.push.mockReset();
  env.authLoading = false;
});

async function submit() {
  const user = userEvent.setup();
  render(<LoginPage />);
  await user.type(screen.getByLabelText(/e-?mail/i), 'a@b.com');
  await user.type(screen.getByLabelText(/senha/i), 'secret1');
  await user.click(screen.getByRole('button', { name: /^entrar$/i }));
}

describe('LoginPage while the first session lookup is pending (BR-001-18)', () => {
  // A sign-in that raced the lookup would be undone by the lookup's anonymous answer.
  it('disables the submit button, with the same label, until the lookup is done', () => {
    env.authLoading = true;
    render(<LoginPage />);

    expect(screen.getByRole('button', { name: /^entrar$/i })).toBeDisabled();
  });

  it('does not submit the form (Enter in a field) while the lookup is pending', () => {
    env.authLoading = true;
    render(<LoginPage />);

    fireEvent.submit(screen.getByRole('button', { name: /^entrar$/i }));

    expect(env.login).not.toHaveBeenCalled();
  });

  it('enables the submit button once the lookup is done', () => {
    render(<LoginPage />);

    expect(screen.getByRole('button', { name: /^entrar$/i })).toBeEnabled();
  });
});

describe('LoginPage', () => {
  it('has one h1 "Entrar" inside a main, with the old subtitle as its summary', async () => {
    const { container } = render(<LoginPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByText(messages.login.subtitle)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute('href', '/register');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the catalogue message of the error code', async () => {
    env.login.mockRejectedValue(new ApiError('INVALID_CREDENTIALS', {}, 401));
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.INVALID_CREDENTIALS);
  });

  it('shows the generic message when the failure is not an API error', async () => {
    env.login.mockRejectedValue(new TypeError('Failed to fetch'));
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.UNKNOWN);
  });

  it('goes home after a successful sign-in', async () => {
    env.login.mockResolvedValue(undefined);
    await submit();

    expect(env.push).toHaveBeenCalledWith('/');
  });

  it('BR-001-08: shows the message of the error code the Google callback redirected with', async () => {
    window.history.pushState({}, '', '/login?error=GOOGLE_EMAIL_NOT_VERIFIED');
    render(<LoginPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.errors.GOOGLE_EMAIL_NOT_VERIFIED,
    );
    window.history.pushState({}, '', '/');
  });

  it('shows the generic message for an error code it does not know, and nothing without one', async () => {
    window.history.pushState({}, '', '/login?error=not-a-code');
    const { unmount } = render(<LoginPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.UNKNOWN);
    unmount();

    window.history.pushState({}, '', '/login');
    render(<LoginPage />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });
});
