import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CURRENT_LEGAL } from '@/test/legal-fixtures';
import { axe, renderWithProviders } from '@/test/render';
import AcceptancesSection from './AcceptancesSection';
import { ACCEPTANCES } from './privacy-test-support';

// TS-19, TS-20. BR-010-04: which versions, when (Brasília time) and how.
describe('AcceptancesSection', () => {
  it.each(['light', 'dark'] as const)(
    'lists every acceptance, newest first, in Brasília time, with the zone said once (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <AcceptancesSection acceptances={ACCEPTANCES} current={CURRENT_LEGAL} />,
        { scheme },
      );

      expect(screen.getByRole('heading', { level: 2, name: 'Aceites' })).toBeVisible();
      const table = screen.getByRole('table', { name: 'Aceites registrados' });
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((header) => header.textContent),
      ).toEqual(['Documento', 'Versão', 'Aceito em (horário de Brasília)', 'Forma']);
      const rows = within(table).getAllByRole('row').slice(1);
      expect(
        rows.map((row) =>
          within(row)
            .getAllByRole('cell')
            .map((cell) => cell.textContent),
        ),
      ).toEqual([
        ['Termos de uso', '0.2 (rascunho)', '19/11/2026 14:32', 'Reaceite'],
        ['Política de privacidade', '0.2 (rascunho)', '19/11/2026 14:32', 'Reaceite'],
        ['Termos de uso', '0.1', '02/11/2026 09:10', 'Cadastro com e-mail'],
        ['Política de privacidade', '0.1', '02/11/2026 09:10', 'Cadastro com e-mail'],
      ]);
      expect(container).toHaveTextContent('com data e hora de Brasília');
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('marks as draft only the version in force that the API says is a draft (older ones carry no flag)', () => {
    renderWithProviders(
      <AcceptancesSection
        acceptances={ACCEPTANCES}
        current={{
          terms: { ...CURRENT_LEGAL.terms, draft: false },
          privacy: CURRENT_LEGAL.privacy,
        }}
      />,
    );

    const table = screen.getByRole('table');
    expect(within(table).getByText('0.2 (rascunho)')).toBeVisible();
    expect(within(table).getAllByText('0.2')).toHaveLength(1);
  });

  it('has a card list for a phone beside the table, with the same facts (DS-13)', () => {
    renderWithProviders(<AcceptancesSection acceptances={ACCEPTANCES} current={null} />);

    const cards = screen.getAllByRole('listitem', { hidden: true });
    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveTextContent('Termos de uso');
    expect(cards[0]).toHaveTextContent('19/11/2026 14:32');
    expect(cards[0]).toHaveTextContent('Reaceite');
  });

  it('links the documents in force', () => {
    renderWithProviders(<AcceptancesSection acceptances={ACCEPTANCES} current={null} />);

    const nav = screen.getByRole('navigation', { name: 'Documentos em vigor' });
    expect(within(nav).getByRole('link', { name: 'Termos de uso' })).toHaveAttribute(
      'href',
      '/termos',
    );
    expect(within(nav).getByRole('link', { name: 'Política de privacidade' })).toHaveAttribute(
      'href',
      '/privacidade',
    );
  });

  it('says so when nothing was accepted yet', () => {
    renderWithProviders(<AcceptancesSection acceptances={[]} current={null} />);

    expect(screen.getByText('Nenhum aceite registrado.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
