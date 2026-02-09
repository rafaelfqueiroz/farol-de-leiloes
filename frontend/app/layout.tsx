import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from './contexts/AuthContext';
import { FavoritesProvider } from './contexts/FavoritesContext';
import { RemindersProvider } from './contexts/RemindersContext';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Farol dos Leilões',
  description: 'Encontre imóveis em leilão da Caixa Econômica Federal',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <AuthProvider>
          <FavoritesProvider>
            <RemindersProvider>{children}</RemindersProvider>
          </FavoritesProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
