import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import ResetPasswordPage from './page';

// SPEC-001: choosing a new password from the emailed link. AR-34: the BFF body names the token
// and `newPassword`. AR-38/AR-39: a refusal shows the catalogue text of the code.
const env = vi.hoisted(() => ({ push: vi.fn() }));
const fetchMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: env.push }),
  useParams: () => ({ token: 'tok-123' }),
}));

beforeEach(() => {
  env.push.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

async function fillAndSubmit(password: string, confirmation: string) {
  const user = userEvent.setup();
  render(<ResetPasswordPage />);
  // a required field's label ends with " *"
  await user.type(screen.getByLabelText(/^Nova Senha/), password);
  await user.type(screen.getByLabelText(/^Confirmar Nova Senha/), confirmation);
  await user.click(screen.getByRole('button', { name: 'Redefinir Senha' }));
}

describe('ResetPasswordPage', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(<ResetPasswordPage />);

    expect(await axe(container)).toHaveNoViolations();
  });

  it('refuses two different passwords without calling the API', async () => {
    await fillAndSubmit('secret-one', 'secret-two');

    expect(await screen.findByRole('alert')).toHaveTextContent('As senhas não coincidem');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a password shorter than six characters without calling the API', async () => {
    await fillAndSubmit('12345', '12345');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A senha deve ter pelo menos 6 caracteres',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a password of exactly six characters', async () => {
    answer(200, {});
    await fillAndSubmit('123456', '123456');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('posts the token and the new password to the BFF', async () => {
    answer(200, {});
    await fillAndSubmit('secret-one', 'secret-one');

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'tok-123', newPassword: 'secret-one' }),
    });
  });

  it('confirms the change and goes to the login after two seconds', async () => {
    // TS-06: a fake clock, never a real wait
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answer(200, {});
    await fillAndSubmit('secret-one', 'secret-one');

    expect(await screen.findByText(messages.resetPassword.confirm.success)).toBeVisible();
    expect(env.push).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(env.push).toHaveBeenCalledWith('/login');
  });

  it('shows the catalogue message when the link is invalid or expired', async () => {
    answer(400, { code: 'INVALID_RESET_TOKEN', context: {} });
    await fillAndSubmit('secret-one', 'secret-one');

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.INVALID_RESET_TOKEN);
    expect(env.push).not.toHaveBeenCalled();
  });
});
