import type { Metadata } from 'next';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { getLocale, getMessages, getTimeZone } from 'next-intl/server';
import { AuthProvider } from './contexts/AuthContext';
import { FavoritesProvider } from './contexts/FavoritesContext';
import { RemindersProvider } from './contexts/RemindersContext';
import AppThemeProvider from './theme/AppThemeProvider';
import { inter } from './theme/fonts';

export const metadata: Metadata = {
  title: 'Farol dos Leilões',
  description: 'Encontre imóveis em leilão da Caixa Econômica Federal',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [locale, timeZone, messages] = await Promise.all([
    getLocale(),
    getTimeZone(),
    getMessages(),
  ]);

  return (
    // DS-07: the scheme class is set on <html> before hydration
    <html lang={locale} suppressHydrationWarning className={inter.variable}>
      <body>
        <InitColorSchemeScript attribute="class" />
        <AppThemeProvider locale={locale} timeZone={timeZone} messages={messages}>
          <AuthProvider>
            <FavoritesProvider>
              <RemindersProvider>{children}</RemindersProvider>
            </FavoritesProvider>
          </AuthProvider>
        </AppThemeProvider>
      </body>
    </html>
  );
}
