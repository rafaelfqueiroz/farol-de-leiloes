import TextField from '@mui/material/TextField';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';

// DS-08: helper text is information, so a disabled field (the read-only e-mail of the profile)
// must not paint it in the disabled grey, which has no contrast requirement. jsdom cannot measure
// contrast; E2E (axe, TS-23) does, this keeps the theme override from being lost.
describe('MuiFormHelperText override', () => {
  it.each(['light', 'dark'] as const)(
    'keeps the helper of a disabled field in the secondary text colour (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <>
          <TextField label="Ativo" helperText="Ajuda ativa" />
          <TextField label="Desativado" disabled helperText="Ajuda desativada" />
        </>,
        { scheme },
      );

      const live = getComputedStyle(screen.getByText('Ajuda ativa')).color;
      const disabled = getComputedStyle(screen.getByText('Ajuda desativada')).color;
      expect(disabled).toBe(live);
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
