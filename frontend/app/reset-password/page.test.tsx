import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import ResetPasswordRequestPage from './page';

// SPEC-001: asking for a reset link. AR-38/AR-39: a refusal shows the catalogue text of the code.
const env = vi.hoisted(() => ({ push: vi.fn() }));
const fetchMock = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));

beforeEach(() => {
  env.push.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

async function submit(email = 'ana@exemplo.test') {
  const user = userEvent.setup();
  render(<ResetPasswordRequestPage />);
  await user.type(screen.getByLabelText(/e-mail/i), email);
  await user.click(screen.getByRole('button', { name: 'Enviar e-mail' }));
  return user;
}

describe('ResetPasswordRequestPage', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(<ResetPasswordRequestPage />);

    expect(await axe(container)).toHaveNoViolations();
  });

  it('posts the email to the BFF and confirms that the link was sent', async () => {
    answer(200, {});
    await submit();

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/reset-password-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ana@exemplo.test' }),
    });
    expect(await screen.findByText(messages.resetPassword.request.success)).toBeVisible();
    expect(screen.queryByLabelText(/e-mail/i)).not.toBeInTheDocument();
  });

  it('goes back to the login from the confirmation', async () => {
    answer(200, {});
    const user = await submit();

    await user.click(await screen.findByRole('button', { name: 'Voltar para o login' }));

    expect(env.push).toHaveBeenCalledWith('/login');
  });

  it('goes back to the login from the form', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordRequestPage />);

    await user.click(screen.getByRole('button', { name: 'Voltar para o login' }));

    expect(env.push).toHaveBeenCalledWith('/login');
  });

  it('shows the catalogue message of the code the API answered with', async () => {
    answer(400, { code: 'VALIDATION_FAILED', context: {} });
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.VALIDATION_FAILED);
    expect(screen.queryByText(messages.resetPassword.request.success)).not.toBeInTheDocument();
  });

  it('shows the generic message when the API cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.UNKNOWN);
  });
});
