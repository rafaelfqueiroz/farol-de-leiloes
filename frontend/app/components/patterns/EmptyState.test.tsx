import FavoriteBorderOutlined from '@mui/icons-material/FavoriteBorderOutlined';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import EmptyState from './EmptyState';

describe('EmptyState', () => {
  it.each(['light', 'dark'] as const)(
    'renders title, description and action, and passes axe (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <EmptyState
          icon={FavoriteBorderOutlined}
          title="Você ainda não tem favoritos"
          description="Toque no coração de um imóvel para guardá-lo aqui."
          actions={<button type="button">Buscar imóveis</button>}
        />,
        { scheme },
      );

      expect(
        screen.getByRole('heading', { level: 2, name: 'Você ainda não tem favoritos' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Toque no coração de um imóvel para guardá-lo aqui.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Buscar imóveis' })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('follows the page outline through titleComponent', () => {
    renderWithProviders(
      <EmptyState
        icon={FavoriteBorderOutlined}
        title="Nada aqui"
        description="Sem itens."
        titleComponent="h3"
      />,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Nada aqui' })).toBeInTheDocument();
  });

  it('hides the decorative icon from assistive tech and omits absent actions', () => {
    const { container } = renderWithProviders(
      <EmptyState icon={FavoriteBorderOutlined} title="Nada" description="Sem itens." />,
    );

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
