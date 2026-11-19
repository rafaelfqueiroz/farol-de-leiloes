import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Button from '@mui/material/Button';
import { axe, renderWithProviders } from '@/test/render';
import InlineAlert from './InlineAlert';

// TS-19: the real theme in both schemes, the real catalogue, and an axe assertion.
describe('InlineAlert', () => {
  it.each(['light', 'dark'] as const)(
    'shows the title, the text and the action, announced as an alert (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <InlineAlert
          severity="warning"
          role="alert"
          title="Não conseguimos cobrar a renovação"
          action={<Button variant="contained">Atualizar forma de pagamento</Button>}
        >
          O plano continua ativo enquanto o provedor tenta de novo.
        </InlineAlert>,
        { scheme },
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Não conseguimos cobrar a renovação');
      expect(alert).toHaveTextContent('O plano continua ativo enquanto o provedor tenta de novo.');
      expect(
        screen.getByRole('button', { name: 'Atualizar forma de pagamento' }),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('is not a live region unless told so, and works with no title and no action', async () => {
    const { container } = renderWithProviders(
      <InlineAlert severity="info">Este é o plano do seu escritório.</InlineAlert>,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Este é o plano do seu escritório.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Este é o plano do seu escritório.')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('announces politely as a status and takes a custom icon', async () => {
    const { container } = renderWithProviders(
      <InlineAlert
        severity="info"
        role="status"
        icon={<span data-testid="icon" />}
        title="Aviso"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Aviso');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
