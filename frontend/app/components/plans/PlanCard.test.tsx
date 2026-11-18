import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined';
import Button from '@mui/material/Button';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import PlanCard from './PlanCard';

// TS-19: the real theme in both schemes, the real catalogue, and an axe assertion.
describe('PlanCard', () => {
  it.each(['light', 'dark'] as const)(
    'names the plan, prices it through Money, states the limit and offers the action (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <PlanCard
          name="Profissional"
          price="449.90"
          interval="month"
          activeJourneyLimit={5}
          hint={{ icon: ArrowUpwardOutlined, text: 'Vale a partir da confirmação do pagamento.' }}
          action={(headingId) => (
            <Button variant="contained" aria-describedby={headingId}>
              Assinar
            </Button>
          )}
        />,
        { scheme },
      );

      const card = screen.getByRole('article', { name: 'Profissional' });
      expect(card).toHaveTextContent('R$ 449,90');
      expect(card).toHaveTextContent('/mês');
      expect(card).toHaveTextContent('por mês');
      expect(card).toHaveTextContent('5 jornadas simultâneas');
      expect(card).toHaveTextContent('Vale a partir da confirmação do pagamento.');
      expect(screen.getByRole('heading', { level: 2, name: 'Profissional' })).toBeInTheDocument();
      // the visible label stays the name; the plan arrives as the description
      const button = screen.getByRole('button', { name: 'Assinar' });
      expect(button).toHaveAccessibleDescription('Profissional');
      expect(screen.queryByText('Plano atual')).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('says "ano" for a yearly plan and uses the singular for one journey', () => {
    renderWithProviders(
      <PlanCard
        name="Individual"
        price="12990.00"
        interval="year"
        activeJourneyLimit={1}
        action={() => <Button>Assinar</Button>}
      />,
    );

    const card = screen.getByRole('article', { name: 'Individual' });
    expect(card).toHaveTextContent('R$ 12.990,00');
    expect(card).toHaveTextContent('/ano');
    expect(card).toHaveTextContent('por ano');
    expect(card).toHaveTextContent('1 jornada simultânea');
  });

  it('marks the current plan with a label, not only a border', async () => {
    const { container } = renderWithProviders(
      <PlanCard
        name="Profissional"
        price="449.90"
        interval="month"
        activeJourneyLimit={5}
        current
        action={() => <Button variant="outlined">Ver plano do escritório</Button>}
      />,
    );

    expect(screen.getByText('Plano atual')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });
});
