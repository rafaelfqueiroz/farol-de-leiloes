import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentLegalResponse } from '@/test/legal-fixtures';
import { renderWithProviders as render } from '@/test/render';
import AccountConsentGate from './AccountConsentGate';

const env = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  pathname: '/search',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => env.pathname,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => env.auth }));

const member = (overrides: Record<string, unknown> = {}) => ({
  loading: false,
  logout: vi.fn(),
  refreshUser: vi.fn(),
  user: {
    termsAcceptanceRequired: false,
    documents: [],
    whatsappPromptPending: false,
    ...overrides,
  },
});

beforeEach(() => {
  env.pathname = '/search';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => currentLegalResponse()),
  );
});
afterEach(() => vi.unstubAllGlobals());

// BR-010-05, BR-010-27: one place decides which dialog, if any, and never two together.
describe('AccountConsentGate', () => {
  it('shows nothing for a visitor, while the account loads, or when nothing is pending', () => {
    env.auth = { loading: false, user: null };
    const { rerender } = render(<AccountConsentGate />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    env.auth = { ...member(), loading: true };
    rerender(<AccountConsentGate />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    env.auth = member();
    rerender(<AccountConsentGate />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the re-acceptance dialog when the account must accept new versions', async () => {
    env.auth = member({ termsAcceptanceRequired: true });
    render(<AccountConsentGate />);

    expect(
      screen.getByRole('dialog', { name: 'Novos termos e política de privacidade' }),
    ).toBeVisible();
    await screen.findByText(/Termos de uso, versão 0.2/);
  });

  it('shows the WhatsApp question when it is pending', () => {
    env.auth = member({ whatsappPromptPending: true });
    render(<AccountConsentGate />);

    expect(screen.getByRole('dialog', { name: 'Avisos por WhatsApp' })).toBeVisible();
  });

  it('never shows both: the documents come first, the WhatsApp question only after', async () => {
    env.auth = member({ termsAcceptanceRequired: true, whatsappPromptPending: true });
    const { rerender } = render(<AccountConsentGate />);

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Novos termos e política de privacidade',
    );
    await screen.findByText(/Termos de uso, versão 0.2/);

    env.auth = member({ termsAcceptanceRequired: false, whatsappPromptPending: true });
    rerender(<AccountConsentGate />);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Avisos por WhatsApp');
  });

  it.each(['/termos', '/privacidade', '/profile/privacidade', '/conta-encerrada'])(
    'steps aside on %s: the documents and the rights stay reachable under a pending version (DL-010-03)',
    (pathname) => {
      env.pathname = pathname;
      env.auth = member({ termsAcceptanceRequired: true, whatsappPromptPending: true });
      render(<AccountConsentGate />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );
});
