'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { shellContentMinHeight } from '@/app/components/patterns/shell-content';

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

  // If authenticated but not verified (local user), don't render children
  if (isAuthenticated && user?.providers?.includes('local') && !user?.providers?.includes('google') && !emailVerified) {
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
