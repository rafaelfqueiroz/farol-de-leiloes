import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import DateText from './DateText';
import KeyFactsGrid from './KeyFactsGrid';
import Money from './Money';

// TS-19: the real theme in both schemes, the real catalogue, and an axe assertion.
describe('KeyFactsGrid', () => {
  it.each(['light', 'dark'] as const)(
    'lists each fact as a term and its value in one definition list (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <KeyFactsGrid
          facts={[
            { id: 'next', label: 'Próxima cobrança', value: <DateText value="2026-12-14" /> },
            { id: 'amount', label: 'Valor da próxima cobrança', value: <Money value="449.90" /> },
            { id: 'since', label: 'Assinante desde', value: 'junho de 2026' },
          ]}
        />,
        { scheme },
      );

      const list = container.querySelector('dl');
      if (!list) throw new Error('The facts are not a <dl>');
      expect(
        within(list)
          .getAllByRole('term')
          .map((term) => term.textContent),
      ).toEqual(['Próxima cobrança', 'Valor da próxima cobrança', 'Assinante desde']);
      expect(
        within(list)
          .getAllByRole('definition')
          .map((definition) => definition.textContent),
      ).toEqual(['14/12/2026', 'R$\u00a0449,90', 'junho de 2026']);
      expect(screen.getByText('14/12/2026').tagName).toBe('TIME');
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('renders an empty list of facts without breaking', async () => {
    const { container } = renderWithProviders(<KeyFactsGrid facts={[]} />);

    expect(container.querySelector('dl')?.children).toHaveLength(0);
    expect(await axe(container)).toHaveNoViolations();
  });
});
