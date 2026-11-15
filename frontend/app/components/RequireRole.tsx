'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Box, CircularProgress, Button } from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { useAuth } from '../contexts/AuthContext';
import EmptyState from '@/app/components/patterns/EmptyState';
import PageShell from '@/app/components/patterns/PageShell';
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
      // DS-15: a full-page state has no PageHeader, so its title is the page's h1
      <PageShell width="reading">
        <EmptyState
          icon={LockOutlined}
          title={t('title')}
          description={
            featureName
              ? t('withFeature', { feature: featureName, plan: planName })
              : t('withoutFeature', { plan: planName })
          }
          titleComponent="h1"
          actions={
            <Button variant="contained" href="/plans">
              {t('viewPlans')}
            </Button>
          }
        />
      </PageShell>
    );
  }

  return <>{children}</>;
}

export function hasMinimumRole(role: string, minimumRole: UserRole): boolean {
  const userLevel = ROLE_HIERARCHY[(role as UserRole) || 'free'];
  const requiredLevel = ROLE_HIERARCHY[minimumRole];
  return userLevel >= requiredLevel;
}
