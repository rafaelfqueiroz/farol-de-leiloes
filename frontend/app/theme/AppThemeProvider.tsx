'use client';

import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { NextIntlClientProvider, type AbstractIntlMessages, type Locale } from 'next-intl';
import { theme } from './theme';

interface AppThemeProviderProps {
  children: React.ReactNode;
  locale: Locale;
  timeZone: string;
  messages: AbstractIntlMessages;
}

// DS-07: the one ThemeProvider, in the root layout. Mode follows the system until the user picks
// one; MUI persists that choice and InitColorSchemeScript applies it before first paint.
export default function AppThemeProvider({
  children,
  locale,
  timeZone,
  messages,
}: AppThemeProviderProps) {
  return (
    <AppRouterCacheProvider>
      <ThemeProvider theme={theme} defaultMode="system">
        <CssBaseline />
        <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
