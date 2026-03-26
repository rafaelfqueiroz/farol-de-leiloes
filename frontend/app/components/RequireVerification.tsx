'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme';

interface RequireVerificationProps {
  children: React.ReactNode;
}

export default function RequireVerification({ children }: RequireVerificationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, isAuthenticated, emailVerified } = useAuth();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      // Only enforce verification for local users (not Google OAuth)
      const needsVerification = user?.providers?.includes('local') && !user?.providers?.includes('google') && !emailVerified;

      if (needsVerification) {
        router.push('/verify-email');
      }
    }
  }, [loading, isAuthenticated, emailVerified, user, router, pathname]);

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.lightGray,
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // If authenticated but not verified (local user), don't render children
  if (isAuthenticated && user?.providers?.includes('local') && !user?.providers?.includes('google') && !emailVerified) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.lightGray,
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return <>{children}</>;
}
