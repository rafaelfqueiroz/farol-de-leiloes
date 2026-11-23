import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CURRENT_LEGAL } from '@/test/legal-fixtures';
import { axe, renderWithProviders } from '@/test/render';
import TermsAcceptance, { type TermsAcceptanceProps } from './TermsAcceptance';

const TERMS = 'Li e aceito os Termos de uso e a Política de privacidade.';
const WHATSAPP = 'Quero receber avisos por WhatsApp (opcional).';
const READY = { status: 'ready', legal: CURRENT_LEGAL } as const;

function Host({
  error = false,
  legal = READY,
  compact,
  onRetryLegal = vi.fn(),
  onChange = vi.fn(),
  onWhatsappChange = vi.fn(),
}: Partial<TermsAcceptanceProps> & { onChange?: () => void; onWhatsappChange?: () => void }) {
  const [checked, setChecked] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  return (
    <TermsAcceptance
      checked={checked}
      error={error}
      legal={legal}
      compact={compact}
      onRetryLegal={onRetryLegal}
      whatsapp={whatsapp}
      onChange={(next) => {
        onChange();
        setChecked(next);
      }}
      onWhatsappChange={(next) => {
        onWhatsappChange();
        setWhatsapp(next);
      }}
    />
  );
}

// TS-19: real theme (both schemes), real catalogue, axe
describe('TermsAcceptance', () => {
  it.each(['light', 'dark'] as const)(
    'is a fieldset of two unticked checkboxes that toggle independently (%s)',
    async (scheme) => {
      const user = userEvent.setup();
      const { container } = renderWithProviders(<Host />, { scheme });

      const group = screen.getByRole('group', { name: 'Termos e privacidade' });
      const terms = within(group).getByRole('checkbox', { name: TERMS });
      const whatsapp = within(group).getByRole('checkbox', { name: WHATSAPP });
      expect(terms).not.toBeChecked();
      expect(whatsapp).not.toBeChecked();

      await user.click(within(group).getByText(WHATSAPP));
      expect(whatsapp).toBeChecked();
      expect(terms).not.toBeChecked();
      await user.click(terms);
      expect(terms).toBeChecked();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('links both documents, opening in a new tab so the form is not lost', () => {
    renderWithProviders(<Host />);

    const terms = screen.getByRole('link', { name: 'Termos de uso' });
    const privacy = screen.getByRole('link', { name: 'Política de privacidade' });
    expect(terms).toHaveAttribute('href', '/termos');
    expect(privacy).toHaveAttribute('href', '/privacidade');
    for (const link of [terms, privacy]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
  });

  it('names the versions in force and ties them to the terms box', () => {
    renderWithProviders(<Host />);

    const note = 'Versões vigentes: termos 0.2 e política 0.2 (rascunho).';
    expect(screen.getByText(note)).toBeVisible();
    expect(screen.getByRole('checkbox', { name: TERMS })).toHaveAccessibleDescription(note);
  });

  it('omits "(rascunho)" for reviewed texts', () => {
    const reviewed = {
      status: 'ready',
      legal: {
        terms: { ...CURRENT_LEGAL.terms, draft: false, version: '1.0' },
        privacy: { ...CURRENT_LEGAL.privacy, draft: false, version: '1.1' },
      },
    } as const;
    renderWithProviders(<Host legal={reviewed} />);

    expect(screen.getByText('Versões vigentes: termos 1.0 e política 1.1.')).toBeVisible();
  });

  it.each(['light', 'dark'] as const)(
    'ties the missing-terms error to the terms box, under the block (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<Host error />, { scheme });

      const error = screen.getByText('Aceite os termos e a política para criar a conta.');
      expect(screen.getByRole('checkbox', { name: TERMS })).toHaveAccessibleDescription(
        expect.stringContaining('Aceite os termos e a política para criar a conta.'),
      );
      expect(
        screen.getByRole('checkbox', { name: TERMS }).compareDocumentPosition(error) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('shows no error text without the error', () => {
    renderWithProviders(<Host />);

    expect(
      screen.queryByText('Aceite os termos e a política para criar a conta.'),
    ).not.toBeInTheDocument();
  });

  it('BR-010-27: the WhatsApp help says it is separate, optional and switches nothing on, in full or short', () => {
    const { rerender } = renderWithProviders(<Host />);
    expect(screen.getByRole('checkbox', { name: WHATSAPP })).toHaveAccessibleDescription(
      /não precisa marcar para criar a conta.*nenhuma mensagem sai sem você ativar o canal/,
    );

    rerender(<Host compact />);
    expect(screen.getByRole('checkbox', { name: WHATSAPP })).toHaveAccessibleDescription(
      'Escolha separada dos termos; pode ser cancelada a qualquer momento.',
    );
  });

  it('shows a labelled placeholder while the versions load, with no version text', async () => {
    const { container } = renderWithProviders(<Host legal={{ status: 'loading' }} />);

    expect(screen.getByRole('status', { name: 'Carregando as versões vigentes' })).toBeVisible();
    expect(screen.queryByText(/Versões vigentes:/)).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says the versions could not be loaded and retries on request', async () => {
    const user = userEvent.setup();
    const onRetryLegal = vi.fn();
    const { container } = renderWithProviders(
      <Host legal={{ status: 'failed', error: new Error('x') }} onRetryLegal={onRetryLegal} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as versões vigentes dos documentos.',
    );
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(onRetryLegal).toHaveBeenCalledTimes(1);
    expect(await axe(container)).toHaveNoViolations();
  });
});
