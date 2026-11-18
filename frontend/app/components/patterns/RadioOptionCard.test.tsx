import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import RadioGroup from '@mui/material/RadioGroup';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import RadioOptionCard from './RadioOptionCard';
import StatusBadge from './StatusBadge';

function Group({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <FormControl component="fieldset">
      <FormLabel component="legend">Planos disponíveis</FormLabel>
      <RadioGroup value={value} onChange={(event) => setValue(event.target.value)}>
        <RadioOptionCard
          value="essencial"
          title="Essencial"
          trailing="R$ 189,90 /mês"
          description="2 jornadas simultâneas"
          effect="Vale a partir do próximo período."
        />
        <RadioOptionCard
          value="profissional"
          title="Profissional"
          trailing="R$ 449,90 /mês"
          description="5 jornadas simultâneas"
          badge={<StatusBadge status="done" label="Plano atual" />}
          disabled
        />
      </RadioGroup>
    </FormControl>
  );
}

// TS-19: the real theme in both schemes, the real catalogue, and an axe assertion.
describe('RadioOptionCard', () => {
  it.each(['light', 'dark'] as const)(
    'is a radio named by its title and described by its details, in a labelled group (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<Group />, { scheme });

      expect(screen.getByRole('radiogroup')).toBeInTheDocument();
      const essencial = screen.getByRole('radio', { name: 'Essencial' });
      expect(essencial).toHaveAccessibleDescription('2 jornadas simultâneas');
      const current = screen.getByRole('radio', { name: 'Profissional' });
      expect(current).toBeDisabled();
      expect(current).toHaveAccessibleDescription('5 jornadas simultâneas Plano atual');
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('selects from a click anywhere on the card and shows the effect only while selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Group />);
    expect(screen.queryByText('Vale a partir do próximo período.')).not.toBeInTheDocument();

    await user.click(screen.getByText('2 jornadas simultâneas'));

    expect(screen.getByRole('radio', { name: 'Essencial' })).toBeChecked();
    expect(screen.getByText('Vale a partir do próximo período.')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Essencial' })).toHaveAccessibleDescription(
      '2 jornadas simultâneas Vale a partir do próximo período.',
    );
  });

  it('does not select a disabled card, and works from the keyboard', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Group />);

    await user.click(screen.getByText('5 jornadas simultâneas'));
    expect(screen.getByRole('radio', { name: 'Profissional' })).not.toBeChecked();

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Essencial' })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('radio', { name: 'Essencial' })).toBeChecked();
  });
});
