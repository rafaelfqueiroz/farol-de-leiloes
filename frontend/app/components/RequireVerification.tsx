'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';

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
      const needsVerification = user?.provider === 'local' && !emailVerified;

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
          backgroundColor: '#FAFAF9',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // If authenticated but not verified (local user), don't render children
  if (isAuthenticated && user?.provider === 'local' && !emailVerified) {
    return (
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
    );
  }

  return <>{children}</>;
}
