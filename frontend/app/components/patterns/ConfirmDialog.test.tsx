import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import ConfirmDialog from './ConfirmDialog';

function renderDialog(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const view = renderWithProviders(
    <ConfirmDialog
      open
      title="Cancelar a jornada de Casa em Lagoa Nova?"
      description="Esta ação não pode ser desfeita."
      confirmLabel="Cancelar jornada"
      cancelLabel="Manter jornada"
      onConfirm={onConfirm}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...view, onConfirm, onClose };
}

describe('ConfirmDialog', () => {
  it.each(['light', 'dark'] as const)('is a labelled alertdialog and passes axe (%s)', async (scheme) => {
    const onClose = vi.fn();
    renderWithProviders(
      <ConfirmDialog
        open
        title="Cancelar a jornada?"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Cancelar jornada"
        onConfirm={() => undefined}
        onClose={onClose}
      />,
      { scheme },
    );

    const dialog = screen.getByRole('alertdialog', { name: 'Cancelar a jornada?' });
    expect(dialog).toHaveAccessibleDescription('Esta ação não pode ser desfeita.');
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('defaults the safe action to the catalogue "Cancelar", first and focused', () => {
    renderDialog({ cancelLabel: undefined });

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancelar', 'Cancelar jornada']);
    expect(buttons[0]).toHaveFocus();
  });

  it('puts the safe action first with initial focus, then the destructive one on Tab', async () => {
    const user = userEvent.setup();
    renderDialog();

    const safe = screen.getByRole('button', { name: 'Manter jornada' });
    const confirm = screen.getByRole('button', { name: 'Cancelar jornada' });
    expect(safe).toHaveFocus();

    await user.tab();
    expect(confirm).toHaveFocus();

    // focus stays inside the dialog
    await user.tab();
    expect(safe).toHaveFocus();
  });

  it('calls onConfirm only from the confirm button', async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Cancelar jornada' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from the safe action and from Esc without confirming', async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Manter jornada' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not dismiss on a backdrop click', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    // eslint-disable-next-line testing-library/no-node-access -- the backdrop has no role
    await user.click(document.querySelector('.MuiBackdrop-root') as Element);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('uses the primary colour when the action is not destructive', () => {
    renderDialog({ destructive: false });

    expect(screen.getByRole('button', { name: 'Cancelar jornada' }).className).toContain('colorPrimary');
  });
});
