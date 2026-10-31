import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import ColorSchemeControl from './ColorSchemeControl';

describe('ColorSchemeControl', () => {
  it.each(['light', 'dark'] as const)(
    'offers the three modes and passes axe (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<ColorSchemeControl />, { scheme });

      expect(screen.getByRole('group', { name: 'Tema' })).toBeInTheDocument();
      for (const name of ['Claro', 'Escuro', 'Sistema']) {
        expect(screen.getByRole('button', { name })).toBeEnabled();
      }
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('marks the current mode and switches on click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ColorSchemeControl />, { scheme: 'light' });

    expect(screen.getByRole('button', { name: 'Claro' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Escuro' }));

    expect(screen.getByRole('button', { name: 'Escuro' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Claro' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement).toHaveClass('dark');
  });
});
