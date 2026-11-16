import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@mui/material';
import { axe, renderWithProviders } from '@/test/render';
import ShellBanner from './ShellBanner';

// TS-19: the real theme in both schemes, the real catalogue, and an axe assertion.
describe('ShellBanner', () => {
  it.each(['light', 'dark'] as const)(
    'announces its message politely, with its action and no close button (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <ShellBanner severity="warning" action={<Button color="inherit">Reenviar link</Button>}>
          Confirme seu e-mail para usar favoritos, filtros, lembretes e a calculadora.
        </ShellBanner>,
        { scheme },
      );

      const banner = screen.getByRole('status');
      expect(banner).toHaveTextContent(/^Confirme seu e-mail/);
      expect(screen.getByRole('button', { name: 'Reenviar link' })).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it.each(['warning', 'info', 'error'] as const)('renders the %s severity', async (severity) => {
    const { container } = renderWithProviders(<ShellBanner severity={severity}>Aviso</ShellBanner>);

    expect(screen.getByRole('status')).toHaveTextContent('Aviso');
    expect(await axe(container)).toHaveNoViolations();
  });
});
