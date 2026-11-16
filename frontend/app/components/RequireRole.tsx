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

/**
 * The plan tiers, lowest first. SPEC-002 BR-002-23: the admin capability is not a plan and sits
 * above none of them; an account's legacy `role: 'admin'` reads as the free tier. The admin
 * capability is `isAdmin` from /api/auth/me, checked on its own (AR-51: all of this is UX only,
 * the server decides).
 */
export type PlanTier = 'free' | 'standard' | 'premium';

const PLAN_RANK: Record<PlanTier, number> = {
  free: 0,
  standard: 1,
  premium: 2,
};

/** The plan tier a `role` stands for; anything that is not a paid tier, `'admin'` included, is free. */
export function planTierOf(role: string): PlanTier {
  return role === 'standard' || role === 'premium' ? role : 'free';
}

interface RequireRoleProps {
  children: React.ReactNode;
  minimumPlan: PlanTier;
  featureName?: string;
}

/** Shows its children only to an account whose plan tier reaches `minimumPlan`. */
export default function RequireRole({ children, minimumPlan, featureName }: RequireRoleProps) {
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

  if (!hasMinimumPlan(role, minimumPlan)) {
    const planName = tPlan(`names.${minimumPlan}`);
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

/** Whether the plan tier `role` stands for reaches `minimumPlan` (an admin role is free). */
export function hasMinimumPlan(role: string, minimumPlan: PlanTier): boolean {
  return PLAN_RANK[planTierOf(role)] >= PLAN_RANK[minimumPlan];
}
