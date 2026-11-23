import EventOutlined from '@mui/icons-material/EventOutlined';
import InventoryOutlined from '@mui/icons-material/Inventory2Outlined';
import TextField from '@mui/material/TextField';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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
  it.each(['light', 'dark'] as const)(
    'is a labelled alertdialog and passes axe (%s)',
    async (scheme) => {
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
    },
  );

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

    // the backdrop has no role, so it can only be found by its MUI class
    const backdrop = document.querySelector('.MuiBackdrop-root');
    if (!backdrop) throw new Error('The dialog backdrop is not rendered');
    await user.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('uses the primary colour when the action is not destructive', () => {
    renderDialog({ destructive: false });

    expect(screen.getByRole('button', { name: 'Cancelar jornada' }).className).toContain(
      'colorPrimary',
    );
  });

  it.each(['light', 'dark'] as const)(
    'carries a richer body: more paragraphs and a list of consequences, all in its description (%s)',
    async (scheme) => {
      renderWithProviders(
        <ConfirmDialog
          open
          title="Cancelar a assinatura do plano Profissional?"
          description="A assinatura deixa de ser renovada."
          consequences={[
            { icon: EventOutlined, text: 'O plano continua valendo até 14/12/2026.' },
            { icon: InventoryOutlined, text: 'Nada é apagado.' },
          ]}
          confirmLabel="Cancelar assinatura"
          cancelLabel="Manter plano"
          onConfirm={() => undefined}
          onClose={() => undefined}
        >
          <p>Você pode desfazer o cancelamento até 14/12/2026.</p>
        </ConfirmDialog>,
        { scheme },
      );

      const dialog = screen.getByRole('alertdialog', {
        name: 'Cancelar a assinatura do plano Profissional?',
      });
      expect(dialog).toHaveAccessibleDescription(
        'A assinatura deixa de ser renovada. Você pode desfazer o cancelamento até 14/12/2026. O plano continua valendo até 14/12/2026. Nada é apagado.',
      );
      expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'O plano continua valendo até 14/12/2026.',
        'Nada é apagado.',
      ]);
      expect(await axe(dialog)).toHaveNoViolations();
    },
  );

  it('while the confirmed action runs the confirm button is busy and the dialog cannot be dismissed', async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = renderDialog({ busy: true, busyLabel: 'Cancelando…' });

    const confirm = screen.getByRole('button', { name: 'Cancelando…' });
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await user.click(confirm);
    await user.keyboard('{Escape}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('owner review #173: the safe action cannot dismiss the dialog while the confirmed action runs', async () => {
    const { onClose, onConfirm } = renderDialog({ busy: true, busyLabel: 'Cancelando…' });

    const keep = screen.getByRole('button', { name: 'Manter jornada' });
    expect(keep).toBeDisabled();
    fireEvent.click(keep); // a click that reaches it anyway does nothing

    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeVisible();
  });

  it('shows the error of a failed action inside the dialog as an alert, and keeps the dialog open', async () => {
    renderDialog({ error: 'Não foi possível cancelar.' });

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Não foi possível cancelar.');
    expect(await axe(dialog)).toHaveNoViolations();
  });

  describe('the field variant (SPEC-010 BR-010-13)', () => {
    function FieldDialog({
      onConfirm = vi.fn(),
      fieldError,
      error,
      busy = false,
    }: {
      onConfirm?: () => void;
      fieldError?: string;
      error?: string;
      busy?: boolean;
    }) {
      const [password, setPassword] = useState('');
      const [understood, setUnderstood] = useState(false);
      return (
        <ConfirmDialog
          open
          title="Excluir sua conta?"
          description="Isto encerra sua conta agora, para sempre."
          confirmLabel="Excluir minha conta"
          cancelLabel="Manter minha conta"
          busy={busy}
          busyLabel="Excluindo"
          error={error}
          confirmDisabled={password === ''}
          acknowledge={{
            label: 'Entendo que não dá para desfazer.',
            checked: understood,
            onChange: setUnderstood,
          }}
          controls={
            <TextField
              label="Sua senha atual"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={fieldError !== undefined}
              helperText={fieldError}
            />
          }
          onConfirm={onConfirm}
          onClose={() => undefined}
        />
      );
    }

    it.each(['light', 'dark'] as const)(
      'keeps the field out of the description, labels it, and passes axe (%s)',
      async (scheme) => {
        renderWithProviders(<FieldDialog fieldError="Senha incorreta." />, { scheme });

        const dialog = screen.getByRole('alertdialog', { name: 'Excluir sua conta?' });
        expect(dialog).toHaveAccessibleDescription('Isto encerra sua conta agora, para sempre.');
        const field = within(dialog).getByLabelText('Sua senha atual');
        expect(field).toHaveAccessibleDescription('Senha incorreta.');
        expect(field).toBeInvalid();
        expect(await axe(dialog)).toHaveNoViolations();
      },
    );

    it('enables the confirm button only with the field filled and the box ticked', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      renderWithProviders(<FieldDialog onConfirm={onConfirm} />);
      const confirm = screen.getByRole('button', { name: 'Excluir minha conta' });
      expect(confirm).toBeDisabled();

      await user.type(screen.getByLabelText('Sua senha atual'), 'segredo');
      expect(confirm).toBeDisabled();
      await user.click(screen.getByRole('checkbox', { name: 'Entendo que não dá para desfazer.' }));
      expect(confirm).toBeEnabled();
      await user.click(confirm);

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('shows a failed attempt as an alert between the field and the box, and locks everything while busy', () => {
      const { rerender } = renderWithProviders(<FieldDialog error="Muitas tentativas." />);
      expect(screen.getByRole('alert')).toHaveTextContent('Muitas tentativas.');

      rerender(<FieldDialog busy />);
      expect(screen.getByRole('checkbox')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Excluindo' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Manter minha conta' })).toBeDisabled();
    });
  });
});
