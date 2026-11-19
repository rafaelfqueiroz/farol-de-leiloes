'use client';

import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ResultScreen } from '@/app/components/patterns/PublicScreens';
import {
  PLANS_API,
  isCheckoutRef,
  type CheckoutState,
  type OfficeSubscription,
} from '@/app/components/plans/plans-api';
import { useAuth } from '@/app/contexts/AuthContext';
import { apiJson } from '@/lib/api-client';
import { ApiError, useApiErrorMessage } from '@/lib/api-error';
import { notifyBillingChanged } from '@/lib/billing-events';

/** BR-012-09: how often the page asks whether the provider confirmed, and how long it keeps asking. */
export const CHECKOUT_POLL_INTERVAL_MS = 3000;
export const CHECKOUT_MAX_WAIT_MS = 90_000;

type Phase =
  | { name: 'reading' }
  | { name: 'missingRef' }
  | { name: 'waiting' }
  | { name: 'confirmed'; subscription: OfficeSubscription | null }
  | { name: 'slow' }
  | { name: 'failed'; message: string; code: string };

/**
 * SPEC-012 BR-012-09, owner decision 10 (frames r1..r5): returning from the checkout grants
 * nothing. The page asks `GET /api/subscriptions/checkout/:ref/status` until the provider's
 * confirmation has been processed, for a bounded time; then it says so (confirmed), or that it is
 * slow (nothing is wrong: the plan is activated when the confirmation arrives), or that it could
 * not ask. It never redirects on its own.
 */
export default function PlansSuccessPage() {
  const t = useTranslations('plansResult.success');
  const apiErrorMessage = useApiErrorMessage();
  const { refreshUser } = useAuth();
  const [phase, setPhase] = useState<Phase>({ name: 'reading' });
  // each "ask again" starts a new bounded wait; an older one stops at its next tick
  const waits = useRef(0);
  const ref = useRef<string | null>(null);

  const wait = useCallback(async () => {
    const mine = ++waits.current;
    const checkoutRef = ref.current;
    if (checkoutRef === null) return;
    setPhase({ name: 'waiting' });
    const startedAt = Date.now();
    const current = () => waits.current === mine;
    while (current()) {
      let state: CheckoutState;
      try {
        state = (await apiJson<{ state: CheckoutState }>(PLANS_API.checkoutStatus(checkoutRef)))
          .state;
      } catch (error: unknown) {
        if (current()) {
          setPhase({
            name: 'failed',
            message: apiErrorMessage(error),
            code: error instanceof ApiError ? error.code : 'UNKNOWN',
          });
        }
        return;
      }
      if (!current()) return;
      if (state === 'CONFIRMED') {
        // the office exists now: the session's personas and the shell's notice must learn it
        await refreshUser();
        let subscription: OfficeSubscription | null = null;
        try {
          subscription = await apiJson<OfficeSubscription>(PLANS_API.subscription);
        } catch {
          // the confirmation stands even if the plan cannot be read just now: say it without the details
        }
        if (current()) {
          notifyBillingChanged();
          setPhase({ name: 'confirmed', subscription });
        }
        return;
      }
      if (Date.now() - startedAt >= CHECKOUT_MAX_WAIT_MS) {
        setPhase({ name: 'slow' });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, CHECKOUT_POLL_INTERVAL_MS));
    }
  }, [apiErrorMessage, refreshUser]);

  useEffect(() => {
    // the query string is an external system, readable only after mount
    const value = new URLSearchParams(window.location.search).get('ref');
    // the ref goes into a URL path: only the shape of a real one is used
    ref.current = value !== null && isCheckoutRef(value) ? value : null;
    if (ref.current === null) {
      setPhase({ name: 'missingRef' });
      return;
    }
    void wait();
    return () => {
      // leaving the page ends the wait
      waits.current += 1;
    };
  }, [wait]);

  const retry = (
    <Button
      variant="contained"
      startIcon={<RefreshOutlined />}
      onClick={() => void wait()}
      fullWidth
    >
      {phase.name === 'failed' ? t('failed.retry') : t('slow.retry')}
    </Button>
  );

  switch (phase.name) {
    case 'reading':
    case 'waiting':
      return (
        <ResultScreen
          loading
          focusTitle
          title={t('waiting.title')}
          description={t('waiting.description')}
          liveStatus={t('waiting.live')}
        >
          <Button component={Link} href="/search" variant="text" fullWidth>
            {t('waiting.goToSearch')}
          </Button>
        </ResultScreen>
      );
    case 'confirmed':
      return (
        <ResultScreen
          tone="success"
          icon={CheckCircleOutlineIcon}
          focusTitle
          title={t('confirmed.title')}
          description={
            phase.subscription
              ? t('confirmed.description', {
                  plan: phase.subscription.plan.name,
                  count: phase.subscription.activeJourneyLimit,
                })
              : t('confirmed.descriptionNoPlan')
          }
        >
          <Button component={Link} href="/office/plan" variant="contained" fullWidth>
            {t('confirmed.action')}
          </Button>
        </ResultScreen>
      );
    case 'slow':
      return (
        <ResultScreen
          tone="info"
          icon={ScheduleOutlined}
          focusTitle
          title={t('slow.title')}
          description={t('slow.description')}
        >
          {retry}
          <Button component={Link} href="/plans" variant="outlined" fullWidth>
            {t('slow.back')}
          </Button>
          <Button component={Link} href="/support" variant="text" fullWidth>
            {t('slow.support')}
          </Button>
        </ResultScreen>
      );
    case 'failed':
      return (
        <ResultScreen
          tone="error"
          icon={ErrorOutlineIcon}
          focusTitle
          title={t('failed.title')}
          description={t('failed.description', { message: phase.message })}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('failed.code', { code: phase.code })}
          </Typography>
          {retry}
        </ResultScreen>
      );
    case 'missingRef':
      return (
        <ResultScreen
          tone="info"
          icon={ScheduleOutlined}
          focusTitle
          title={t('missingRef.title')}
          description={t('missingRef.description')}
        >
          <Button component={Link} href="/plans" variant="contained" fullWidth>
            {t('missingRef.action')}
          </Button>
        </ResultScreen>
      );
  }
}
