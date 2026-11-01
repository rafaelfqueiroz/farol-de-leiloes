'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { shellContentMinHeight } from '@/app/components/patterns/shell-content';

interface RequireAuthenticationProps {
  children: React.ReactNode;
}

export default function RequireAuthentication({ children }: RequireAuthenticationProps) {
  const router = useRouter();
  const { loading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  if (loading) {
    return (
      <Box
        sx={(theme) => ({
          // #42: fills the AppShell content area, not the whole viewport
          ...shellContentMinHeight(theme),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return (
      <Box
        sx={(theme) => ({
          // #42: fills the AppShell content area, not the whole viewport
          ...shellContentMinHeight(theme),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        <CircularProgress />
      </Box>
    );
  }

  return <>{children}</>;
}
