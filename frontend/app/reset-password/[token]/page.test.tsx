import { act, screen, waitFor } from '@testing-library/react';
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

const t = messages.resetPassword.confirm;

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
  it('has one h1 inside a main, with the hint as its summary', async () => {
    const { container } = render(<ResetPasswordPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeInTheDocument();
    expect(screen.getByText(t.hint)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('refuses passwords that differ without calling the API', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText(/^nova senha/i), 'secret-one');
    await user.type(screen.getByLabelText(/confirmar nova senha/i), 'secret2');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(t.errors.passwordMismatch);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the success message after a reset', async () => {
    // TS-06: the page schedules a redirect after two seconds; on a fake clock it never fires into a
    // later test (a real timer leaking past this test made the catalogue-message test flaky)
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answer(200, {});
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText(/^nova senha/i), 'secret-one');
    await user.type(screen.getByLabelText(/confirmar nova senha/i), 'secret-one');
    await user.click(screen.getByRole('button', { name: t.submit }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(t.success));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('refuses two different passwords without calling the API', async () => {
    await fillAndSubmit('secret-one', 'secret-two');

    expect(await screen.findByRole('alert')).toHaveTextContent('As senhas não coincidem');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a password shorter than eight characters without calling the API', async () => {
    await fillAndSubmit('1234567', '1234567');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A senha deve ter pelo menos 8 caracteres',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a password of exactly eight characters', async () => {
    answer(200, {});
    await fillAndSubmit('12345678', '12345678');

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
    // the redirect is scheduled by an effect: let it commit before moving the clock
    await act(async () => {});
    expect(env.push).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(env.push).toHaveBeenCalledWith('/login');
  });

  it('does not redirect after the page is left before the two seconds', async () => {
    // a timer outliving the component would navigate a user who already left
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answer(200, {});
    const user = userEvent.setup();
    const { unmount } = render(<ResetPasswordPage />);
    await user.type(screen.getByLabelText(/^nova senha/i), 'secret-one');
    await user.type(screen.getByLabelText(/confirmar nova senha/i), 'secret-one');
    await user.click(screen.getByRole('button', { name: t.submit }));
    await screen.findByText(t.success);
    await act(async () => {});

    unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(env.push).not.toHaveBeenCalled();
  });

  it('shows the catalogue message when the link is invalid or expired', async () => {
    answer(400, { code: 'INVALID_RESET_TOKEN', context: {} });
    await fillAndSubmit('secret-one', 'secret-one');

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.INVALID_RESET_TOKEN);
    expect(env.push).not.toHaveBeenCalled();
  });
});
