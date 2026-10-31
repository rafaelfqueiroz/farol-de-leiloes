'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, CircularProgress, Typography, Button } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import { useAuth } from '../contexts/AuthContext';

type UserRole = 'free' | 'standard' | 'premium' | 'admin';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  free: 0,
  standard: 1,
  premium: 2,
  admin: 3,
};

interface RequireRoleProps {
  children: React.ReactNode;
  minimumRole: UserRole;
  featureName?: string;
}

export default function RequireRole({ children, minimumRole, featureName }: RequireRoleProps) {
  const { loading, isAuthenticated, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FFFFFF',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FFFFFF',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  const userLevel = ROLE_HIERARCHY[(role as UserRole) || 'free'];
  const requiredLevel = ROLE_HIERARCHY[minimumRole];

  if (userLevel < requiredLevel) {
    const planName = minimumRole === 'standard' ? 'Standard' : minimumRole === 'premium' ? 'Premium' : 'Admin';
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FFFFFF',
        }}
      >
        <Box sx={{ textAlign: 'center', maxWidth: 400 }}>
          <LockIcon sx={{ fontSize: 64, mb: 2, opacity: 0.5 }} />
          <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
            Acesso restrito
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            {featureName
              ? `O recurso "${featureName}" requer o plano ${planName} ou superior.`
              : `Esta pagina requer o plano ${planName} ou superior.`}
          </Typography>
          <Button variant="contained" href="/plans">
            Ver planos
          </Button>
        </Box>
      </Box>
    );
  }

  return <>{children}</>;
}

export function hasMinimumRole(role: string, minimumRole: UserRole): boolean {
  const userLevel = ROLE_HIERARCHY[(role as UserRole) || 'free'];
  const requiredLevel = ROLE_HIERARCHY[minimumRole];
  return userLevel >= requiredLevel;
}
