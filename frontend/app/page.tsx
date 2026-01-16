'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeProvider, Box, CircularProgress } from '@mui/material';
import LandingPage from './components/LandingPage';
import { FavoritesProvider } from './contexts/FavoritesContext';
import { useAuth } from './contexts/AuthContext';
import theme from './theme';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.push('/search');
    }
  }, [isAuthenticated, loading, router]);

  // Show loading state while checking auth
  if (loading) {
    return (
      <ThemeProvider theme={theme}>
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#FAFAF9',
          }}
        >
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  }

  // If authenticated, show loading while redirecting
  if (isAuthenticated) {
    return (
      <ThemeProvider theme={theme}>
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#FAFAF9',
          }}
        >
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  }

  // Show landing page for unauthenticated users
  return (
    <ThemeProvider theme={theme}>
      <FavoritesProvider>
        <LandingPage />
      </FavoritesProvider>
    </ThemeProvider>
  );
}
