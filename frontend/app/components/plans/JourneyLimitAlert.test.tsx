import Button from '@mui/material/Button';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError, useApiErrorMessage } from '@/lib/api-error';
import { axe, renderWithProviders } from '@/test/render';
import JourneyLimitAlert from './JourneyLimitAlert';

// TS-19: the real theme in both schemes, the real catalogue, and an axe assertion.
describe('JourneyLimitAlert (BR-012-25)', () => {
  it.each(['light', 'dark'] as const)(
    'says the count and the limit and names both ways forward (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <JourneyLimitAlert inProgress={2} limit={2} action={<Button>Mudar de plano</Button>} />,
        { scheme },
      );

      expect(
        screen.getByText(
          'Limite de jornadas atingido: 2 de 2. Encerre uma jornada ou mude de plano.',
        ),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Mudar de plano' })).toBeVisible();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('the API error JOURNEY_LIMIT_REACHED carries the same figures, with both ways forward, in its message', () => {
    function Message() {
      const message = useApiErrorMessage();
      return (
        <p>{message(new ApiError('JOURNEY_LIMIT_REACHED', { inProgress: 5, limit: 5 }, 409))}</p>
      );
    }
    renderWithProviders(<Message />);

    expect(
      screen.getByText(
        'O escritório atingiu o limite de jornadas em andamento (5 de 5). Encerre uma jornada ou mude de plano para iniciar outra.',
      ),
    ).toBeVisible();
  });
});
