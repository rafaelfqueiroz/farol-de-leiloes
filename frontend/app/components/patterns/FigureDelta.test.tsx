import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import FigureDelta from './FigureDelta';

describe('FigureDelta', () => {
  it.each(['light', 'dark'] as const)(
    'shows the value with a named arrow and passes axe (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <FigureDelta value="12,5%" tone="positive" direction="up" />,
        { scheme },
      );

      expect(screen.getByText('12,5%')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Aumento favorável' })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it.each([
    ['up', 'positive', 'Aumento favorável'],
    ['up', 'negative', 'Aumento desfavorável'],
    ['down', 'positive', 'Redução favorável'],
    ['down', 'negative', 'Redução desfavorável'],
  ] as const)('names %s/%s as "%s": colour is never the only signal', (direction, tone, name) => {
    renderWithProviders(<FigureDelta value="8%" tone={tone} direction={direction} />);

    expect(screen.getByRole('img', { name })).toBeInTheDocument();
  });

  it('points down for a discount that is favourable', () => {
    const { container } = renderWithProviders(
      <FigureDelta value="18%" tone="positive" direction="down" />,
    );

    expect(
      container.querySelector('[data-testid="ArrowDownwardOutlinedIcon"]'),
    ).toBeInTheDocument();
  });
});
