import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import messages from '@/messages/pt-BR.json';
import { renderWithProviders as render } from '@/test/render';
import LoginPage from './page';

// AR-39: a failed sign-in shows the pt-BR message of the code the API answered with, never the
// backend's own text and never a hardcoded English fallback.
const env = vi.hoisted(() => ({ login: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ login: env.login }) }));

beforeEach(() => {
  env.login.mockReset();
  env.push.mockReset();
});

async function submit() {
  const user = userEvent.setup();
  render(<LoginPage />);
  await user.type(screen.getByLabelText(/e-?mail/i), 'a@b.com');
  await user.type(screen.getByLabelText(/senha/i), 'secret1');
  await user.click(screen.getByRole('button', { name: /^entrar$/i }));
}

describe('LoginPage', () => {
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
});
