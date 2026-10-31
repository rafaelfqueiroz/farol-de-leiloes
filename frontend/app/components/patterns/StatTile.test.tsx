import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import FigureDelta from './FigureDelta';
import Money from './Money';
import StatTile from './StatTile';

describe('StatTile', () => {
  it.each(['light', 'dark'] as const)('renders label, value and context, and passes axe (%s)', async (scheme) => {
    const { container } = renderWithProviders(
      <StatTile
        label="Valor em jornada"
        value={<Money value="2400000" compact />}
        context={<FigureDelta value="12,5%" tone="positive" direction="up" />}
      />,
      { scheme },
    );

    expect(screen.getByText('Valor em jornada')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'R$\u00a02.400.000,00' })).toBeInTheDocument();
    expect(screen.getByText('12,5%')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('omits the context line when there is none', () => {
    const { container } = renderWithProviders(<StatTile label="Investidores" value="48" />);

    expect(screen.getByText('48')).toBeInTheDocument();
    // overline label + metric value only
    expect(container.firstElementChild?.children).toHaveLength(2);
  });
});
