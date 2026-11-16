import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import TermsAcceptance from './TermsAcceptance';

const TERMS = 'Li e aceito os Termos de uso e a Política de privacidade';

function Host({ error = false, onChange = vi.fn() }: { error?: boolean; onChange?: () => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <TermsAcceptance
      checked={checked}
      error={error}
      onChange={(next) => {
        onChange();
        setChecked(next);
      }}
    />
  );
}

// TS-19: real theme (both schemes), real catalogue, axe
describe('TermsAcceptance', () => {
  it.each(['light', 'dark'] as const)(
    'is one labelled checkbox, unticked, that toggles (%s)',
    async (scheme) => {
      const user = userEvent.setup();
      const { container } = renderWithProviders(<Host />, { scheme });

      const box = screen.getByRole('checkbox', { name: TERMS });
      expect(box).not.toBeChecked();
      await user.click(screen.getByText(TERMS));
      expect(box).toBeChecked();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it.each(['light', 'dark'] as const)(
    'ties the missing-terms error to the checkbox under the block (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<Host error />, { scheme });

      const error = screen.getByText('Aceite os termos para criar a conta');
      expect(screen.getByRole('checkbox', { name: TERMS })).toHaveAccessibleDescription(
        'Aceite os termos para criar a conta',
      );
      expect(
        screen.getByText(TERMS).compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('shows no error text without the error', () => {
    renderWithProviders(<Host />);

    expect(screen.queryByText('Aceite os termos para criar a conta')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: TERMS })).not.toHaveAccessibleDescription();
  });
});
