import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import PageHeader from './PageHeader';

describe('PageHeader', () => {
  it.each(['light', 'dark'] as const)(
    'renders title, summary, slots and passes axe (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <PageHeader
          title="Buscar imóveis"
          summary="348 imóveis encontrados"
          breadcrumbs={<nav aria-label="Caminho">Início</nav>}
          actions={<button type="button">Salvar busca</button>}
        />,
        { scheme },
      );

      expect(screen.getByRole('heading', { level: 1, name: 'Buscar imóveis' })).toBeInTheDocument();
      expect(screen.getByText('348 imóveis encontrados')).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Caminho' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Salvar busca' })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('renders exactly one h1 and nothing optional when only a title is given', () => {
    renderWithProviders(<PageHeader title="Favoritos" />);

    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('puts the breadcrumbs before the title in reading order', () => {
    renderWithProviders(
      <PageHeader title="Detalhe" breadcrumbs={<nav aria-label="Caminho">x</nav>} />,
    );

    const nav = screen.getByRole('navigation');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(nav.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
