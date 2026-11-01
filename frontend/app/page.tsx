'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, CircularProgress } from '@mui/material';
import LandingPage from './components/LandingPage';
import { FavoritesProvider } from './contexts/FavoritesContext';
import { useAuth } from './contexts/AuthContext';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, loading, user, emailVerified } = useAuth();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      if (
        user?.providers?.includes('local') &&
        !user?.providers?.includes('google') &&
        !emailVerified
      ) {
        router.push('/verify-email');
      } else {
        router.push('/search');
      }
    }
  }, [isAuthenticated, loading, user, emailVerified, router]);

  // Show loading state while checking auth
  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // If authenticated, show loading while redirecting
  if (isAuthenticated) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // Show landing page for unauthenticated users
  return (
    <FavoritesProvider>
      <LandingPage />
    </FavoritesProvider>
  );
}
