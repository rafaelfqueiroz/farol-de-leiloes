import type { Metadata } from 'next';
import { headers } from 'next/headers';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { getLocale, getMessages, getTimeZone, getTranslations } from 'next-intl/server';
import AccountConsentGate from './components/account/AccountConsentGate';
import ReauthReturnCapture from './components/account/ReauthReturnCapture';
import { AuthProvider } from './contexts/AuthContext';
import { FavoritesProvider } from './contexts/FavoritesContext';
import { RemindersProvider } from './contexts/RemindersContext';
import AppThemeProvider from './theme/AppThemeProvider';
import { inter } from './theme/fonts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t('title'), description: t('description') };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, timeZone, messages] = await Promise.all([
    getLocale(),
    getTimeZone(),
    getMessages(),
  ]);
  // SC-17: headers() makes HTML dynamic so every render uses the request's nonce.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    // DS-07: the scheme class is set on <html> before hydration
    <html lang={locale} suppressHydrationWarning className={inter.variable}>
      <body>
        <InitColorSchemeScript attribute="class" nonce={nonce} />
        {/* SPEC-010: first, so the one-time code of a re-authentication is out of the address before anything else runs */}
        <ReauthReturnCapture />
        <AppThemeProvider locale={locale} timeZone={timeZone} messages={messages} nonce={nonce}>
          <AuthProvider>
            <FavoritesProvider>
              <RemindersProvider>
                {children}
                {/* SPEC-010: the re-acceptance and WhatsApp dialogs, decided in one place */}
                <AccountConsentGate />
              </RemindersProvider>
            </FavoritesProvider>
          </AuthProvider>
        </AppThemeProvider>
      </body>
    </html>
  );
}
