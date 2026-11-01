import Decimal from 'decimal.js';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import Money from './Money';

describe('Money', () => {
  it.each(['light', 'dark'] as const)(
    'formats a BRL amount and passes axe (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<Money value="1234.56" />, { scheme });

      // non-breaking space after the symbol
      expect(container.textContent).toBe('R$\u00a01.234,56');
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('accepts a Decimal and rounds half to even', () => {
    const { container } = renderWithProviders(<Money value={new Decimal('0.125')} />);

    expect(container.textContent).toBe('R$\u00a00,12');
  });

  it('renders compact with the full value as the accessible name', async () => {
    const { container } = renderWithProviders(<Money value="2400000" compact />);

    const amount = screen.getByRole('img', { name: 'R$\u00a02.400.000,00' });
    expect(amount.textContent).toBe('R$\u00a02,4\u00a0mi');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows "Não informado" for null, never R$ 0,00', async () => {
    const { container } = renderWithProviders(<Money value={null} />);

    expect(screen.getByText('Não informado')).toBeInTheDocument();
    expect(container.textContent).not.toContain('R$');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('uses tabular numerals so columns line up (DS-12)', () => {
    renderWithProviders(<Money value="10" variant="metric" />);

    expect(
      getComputedStyle(screen.getByText('R$\u00a010,00', { normalizer: (text) => text }))
        .fontVariantNumeric,
    ).toBe('tabular-nums');
  });
});
