import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import ResetPasswordRequestPage from './page';

const env = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));

beforeEach(() => {
  env.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ResetPasswordRequestPage', () => {
  it('has one h1 inside a main, with the hint as its summary', async () => {
    const { container } = render(<ResetPasswordRequestPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: messages.resetPassword.request.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(messages.resetPassword.request.hint)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('goes back to the sign-in page from the text link', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordRequestPage />);

    await user.click(
      screen.getByRole('button', { name: messages.resetPassword.request.backToLogin }),
    );

    expect(env.push).toHaveBeenCalledWith('/login');
  });

  it('confirms the e-mail was sent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const user = userEvent.setup();
    render(<ResetPasswordRequestPage />);

    await user.type(screen.getByLabelText(/e-?mail/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: messages.resetPassword.request.submit }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(messages.resetPassword.request.success),
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
