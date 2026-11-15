import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import ResetPasswordPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ token: 'tok-1' }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const t = messages.resetPassword.confirm;

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
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText(/^nova senha/i), 'secret1');
    await user.type(screen.getByLabelText(/confirmar nova senha/i), 'secret2');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(t.errors.passwordMismatch);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the success message after a reset', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText(/^nova senha/i), 'secret1');
    await user.type(screen.getByLabelText(/confirmar nova senha/i), 'secret1');
    await user.click(screen.getByRole('button', { name: t.submit }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(t.success));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
