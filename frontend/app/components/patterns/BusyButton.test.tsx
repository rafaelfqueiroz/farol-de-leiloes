import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import BusyButton from './BusyButton';

// TS-19: the real theme in both schemes, the real catalogue, and an axe assertion.
describe('BusyButton', () => {
  it.each(['light', 'dark'] as const)(
    'is an ordinary button until busy, then aria-busy with its running label (%s)',
    async (scheme) => {
      const { container, rerender } = renderWithProviders(
        <BusyButton busyLabel="Abrindo pagamento…" variant="contained">
          Assinar
        </BusyButton>,
        { scheme },
      );
      const idle = screen.getByRole('button', { name: 'Assinar' });
      expect(idle).not.toHaveAttribute('aria-busy');
      expect(await axe(container)).toHaveNoViolations();

      rerender(
        <BusyButton busy busyLabel="Abrindo pagamento…" variant="contained">
          Assinar
        </BusyButton>,
      );

      const busy = screen.getByRole('button', { name: 'Abrindo pagamento…' });
      expect(busy).toHaveAttribute('aria-busy', 'true');
      expect(busy).toHaveAttribute('aria-disabled', 'true');
      expect(busy).not.toBeDisabled();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('ignores clicks while busy and keeps focus on the button', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = renderWithProviders(
      <BusyButton busyLabel="Mudando…" onClick={onClick}>
        Mudar
      </BusyButton>,
    );
    await user.click(screen.getByRole('button', { name: 'Mudar' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    screen.getByRole('button', { name: 'Mudar' }).focus();
    rerender(
      <BusyButton busy busyLabel="Mudando…" onClick={onClick}>
        Mudar
      </BusyButton>,
    );
    await user.click(screen.getByRole('button', { name: 'Mudando…' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Mudando…' })).toHaveFocus();
  });

  it('goes back to its label and stops reserving the width when the action ends', () => {
    const { rerender } = renderWithProviders(
      <BusyButton busy busyLabel="Mudando…">
        Mudar
      </BusyButton>,
    );
    rerender(<BusyButton busyLabel="Mudando…">Mudar</BusyButton>);

    const button = screen.getByRole('button', { name: 'Mudar' });
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('can still be disabled outright', () => {
    renderWithProviders(
      <BusyButton disabled busyLabel="Mudando…">
        Mudar
      </BusyButton>,
    );

    expect(screen.getByRole('button', { name: 'Mudar' })).toBeDisabled();
  });
});
