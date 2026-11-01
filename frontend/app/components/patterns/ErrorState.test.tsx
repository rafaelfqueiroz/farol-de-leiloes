import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import ErrorState from './ErrorState';

describe('ErrorState', () => {
  it.each(['light', 'dark'] as const)(
    'renders the message, code and retry, and passes axe (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <ErrorState
          title="Não foi possível carregar os imóveis"
          message="Tente novamente em instantes."
          code="AUC-503"
          onRetry={() => undefined}
        />,
        { scheme },
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Não foi possível carregar os imóveis' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Tente novamente em instantes.')).toBeInTheDocument();
      expect(screen.getByText('Código AUC-503')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('calls onRetry from the "Tentar novamente" button', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderWithProviders(<ErrorState title="Falha" message="Tente de novo." onRetry={onRetry} />);

    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the code line when there is no code', () => {
    renderWithProviders(
      <ErrorState title="Falha" message="Tente de novo." onRetry={() => undefined} />,
    );

    expect(screen.queryByText(/^Código/)).not.toBeInTheDocument();
  });
});
