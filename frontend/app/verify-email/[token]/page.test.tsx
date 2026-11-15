import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import VerifyEmailTokenPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ token: 'tok-1' }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const t = messages.verifyEmail.token;

describe('VerifyEmailTokenPage', () => {
  it('shows the verifying h1 while the token is checked', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render(<VerifyEmailTokenPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: t.loadingTitle })).toBeInTheDocument();
  });

  it('switches the h1 to "verified" and offers the sign-in link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { container } = render(<VerifyEmailTokenPage />);

    expect(
      await screen.findByRole('heading', { level: 1, name: t.successTitle }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: t.goToLogin })).toHaveAttribute('href', '/login');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('switches the h1 to the error state with the message and the way out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ code: 'INVALID_TOKEN' }),
      }),
    );
    const { container } = render(<VerifyEmailTokenPage />);

    expect(
      await screen.findByRole('heading', { level: 1, name: t.errorTitle }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.goToLogin })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
