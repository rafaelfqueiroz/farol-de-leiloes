import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { configureAxe } from 'vitest-axe';
import { theme } from '@/app/theme/theme';
import type { SchemeName } from '@/app/theme/tokens';
import { LOCALE, TIME_ZONE } from '@/i18n/config';
import messages from '@/messages/pt-BR.json';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  scheme?: SchemeName;
}

// TS-19: the real theme in a forced scheme and the real pt-BR catalogue. A missing key throws
// instead of rendering the key as text.
export function renderWithProviders(
  ui: ReactElement,
  { scheme = 'light', ...options }: RenderWithProvidersOptions = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider theme={theme} defaultMode={scheme} storageManager={null} noSsr>
        <CssBaseline />
        <NextIntlClientProvider
          locale={LOCALE}
          timeZone={TIME_ZONE}
          messages={messages}
          onError={(error) => {
            throw error;
          }}
        >
          {children}
        </NextIntlClientProvider>
      </ThemeProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}

// TESTING §5: jsdom cannot measure contrast; DS-08's token test and E2E cover it.
export const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });
