'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Box, CircularProgress, Typography, Button } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import { useAuth } from '../contexts/AuthContext';
import { shellContentMinHeight } from '@/app/components/patterns/shell-content';

export type UserRole = 'free' | 'standard' | 'premium' | 'admin';

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
  const t = useTranslations('requireRole');
  const tPlan = useTranslations('plan');
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

  const userLevel = ROLE_HIERARCHY[(role as UserRole) || 'free'];
  const requiredLevel = ROLE_HIERARCHY[minimumRole];

  if (userLevel < requiredLevel) {
    const planKey = minimumRole === 'standard' || minimumRole === 'premium' ? minimumRole : 'admin';
    const planName = tPlan(`names.${planKey}`);
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
        <Box sx={{ textAlign: 'center', maxWidth: 400 }}>
          <LockIcon sx={{ fontSize: 64, mb: 2, opacity: 0.5 }} />
          <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
            {t('title')}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            {featureName
              ? t('withFeature', { feature: featureName, plan: planName })
              : t('withoutFeature', { plan: planName })}
          </Typography>
          <Button variant="contained" href="/plans">
            {t('viewPlans')}
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
