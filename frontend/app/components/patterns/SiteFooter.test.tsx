import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import SiteFooter from './SiteFooter';

// TS-19: real theme (both schemes), real catalogue, axe
describe('SiteFooter', () => {
  it.each(['light', 'dark'] as const)(
    'is a contentinfo with a labelled navigation to the terms, the policy and support (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<SiteFooter year={2026} />, { scheme });

      const footer = screen.getByRole('contentinfo');
      const nav = within(footer).getByRole('navigation', { name: 'Informações legais e suporte' });
      expect(
        within(nav)
          .getAllByRole('link')
          .map((link) => [link.textContent, link.getAttribute('href')]),
      ).toEqual([
        ['Termos de uso', '/termos'],
        ['Política de privacidade', '/privacidade'],
        ['Suporte', '/support'],
      ]);
      expect(within(footer).getByText('© 2026 Farol dos Leilões')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('defaults the notice to the current year', () => {
    renderWithProviders(<SiteFooter />);

    expect(screen.getByText(`© ${new Date().getUTCFullYear()} Farol dos Leilões`)).toBeVisible();
  });
});
