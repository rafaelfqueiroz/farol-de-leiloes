import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import ProgressBar from './ProgressBar';

// TS-19: the real theme in both schemes, the real catalogue, and an axe assertion.
describe('ProgressBar', () => {
  it.each(['light', 'dark'] as const)(
    'is a named progressbar with its own value range (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <ProgressBar
          value={4}
          max={5}
          label="Jornadas em andamento"
          valueText="4 de 5 jornadas em andamento"
        />,
        { scheme },
      );

      const bar = screen.getByRole('progressbar', { name: 'Jornadas em andamento' });
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '5');
      expect(bar).toHaveAttribute('aria-valuenow', '4');
      expect(bar).toHaveAttribute('aria-valuetext', '4 de 5 jornadas em andamento');
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('never reports a value outside 0..max', () => {
    const { rerender } = renderWithProviders(<ProgressBar value={9} max={5} label="Uso" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');

    rerender(<ProgressBar value={-2} max={5} label="Uso" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('renders the warning tone and passes axe', async () => {
    const { container } = renderWithProviders(
      <ProgressBar value={5} max={5} label="Uso" tone="warning" />,
    );

    expect(screen.getByRole('progressbar', { name: 'Uso' }).className).toContain('colorWarning');
    expect(await axe(container)).toHaveNoViolations();
  });
});
