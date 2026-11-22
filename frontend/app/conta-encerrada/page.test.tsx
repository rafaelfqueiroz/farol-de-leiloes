import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import AccountClosedPage from './page';

const env = vi.hoisted(() => ({ refreshUser: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/app/contexts/AuthContext', () => ({
  useAuth: () => ({ refreshUser: env.refreshUser }),
}));

beforeEach(() => env.refreshUser.mockReset().mockResolvedValue(undefined));

// SPEC-010 BR-010-14, frame "Conta encerrada"
describe('/conta-encerrada', () => {
  it.each(['light', 'dark'] as const)(
    'is a public result screen with one h1, what happened and the way out (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<AccountClosedPage />, { scheme });

      expect(screen.getByRole('main')).toBeVisible();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Sua conta foi encerrada' }),
      ).toBeVisible();
      expect(container).toHaveTextContent(
        'Você saiu de todos os aparelhos. Apagamos seus dados pessoais em até 30 dias, exceto o que a lei manda guardar. Não enviaremos mais nenhum aviso.',
      );
      expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/');
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('asks who is signed in once, so the app forgets the account it still remembers', async () => {
    renderWithProviders(<AccountClosedPage />);

    await waitFor(() => expect(env.refreshUser).toHaveBeenCalledTimes(1));
  });
});
