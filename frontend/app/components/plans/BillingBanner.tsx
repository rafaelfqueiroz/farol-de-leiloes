'use client';

import Button from '@mui/material/Button';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import BusyButton from '@/app/components/patterns/BusyButton';
import DateText from '@/app/components/patterns/DateText';
import ShellBanner from '@/app/components/patterns/ShellBanner';
import { useAuth } from '@/app/contexts/AuthContext';
import { apiJson } from '@/lib/api-client';
import { ApiError, useApiErrorMessage } from '@/lib/api-error';
import { onBillingChanged } from '@/lib/billing-events';
import { reportClientError } from '@/lib/report-client-error';
import { httpsUrlOrNull } from '@/lib/safe-url';
import { PLANS_API, type OfficeSubscription } from './plans-api';

type Notice = 'pastDue' | 'grace' | 'readOnly';

/** The plan states that need every member's attention (BR-012-20, BR-012-21, BR-012-28). */
export function billingNoticeOf(subscription: OfficeSubscription): Notice | null {
  if (subscription.status === 'PAST_DUE') return 'pastDue';
  if (subscription.status !== 'LAPSED') return null;
  return subscription.readOnly ? 'readOnly' : 'grace';
}

export interface BillingBannerProps {
  /** What the slot holds when there is no billing notice (the unconfirmed-e-mail warning). */
  children?: ReactNode;
}

/**
 * SPEC-012 owner decision 1 (frame o18): the billing notices of an office (payment failed, lapsed
 * in the grace period, read-only) in the shell's banner slot, on every page, for every member.
 * One notice at a time, and a billing notice takes priority over the unconfirmed-e-mail one, which
 * comes back when there is none. The office plan page shows the same facts in its own alert, so the
 * banner stays out of that page. It reads the plan again when an action changed it
 * (`notifyBillingChanged`), and says nothing at all when the plan cannot be read: the page that
 * needs it says so itself.
 */
export default function BillingBanner({ children }: BillingBannerProps) {
  const t = useTranslations('officePlan.banner');
  const apiErrorMessage = useApiErrorMessage();
  const pathname = usePathname();
  const { user, isAuthenticated, personas } = useAuth();
  const isMember = isAuthenticated && personas.includes('advisor');
  const userId = user?._id ?? null;
  const [subscription, setSubscription] = useState<OfficeSubscription | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  // The newest read wins: an older answer that arrives late (an initial read overtaken by the
  // refresh an action triggered, or one made for the previous account) is dropped.
  const reads = useRef(0);

  const read = useCallback(async () => {
    const mine = ++reads.current;
    try {
      const answer = await apiJson<OfficeSubscription>(PLANS_API.subscription);
      if (reads.current === mine) setSubscription(answer);
    } catch (error: unknown) {
      if (reads.current !== mine) return;
      setSubscription(null);
      // an office with no plan yet, or no office: nothing to say. Anything else is worth a report.
      const quiet =
        error instanceof ApiError &&
        (error.code === 'FORBIDDEN' || error.code === 'SUBSCRIPTION_NOT_FOUND');
      if (!quiet) reportClientError(error, { where: 'BillingBanner.read' });
    }
  }, []);

  useEffect(() => {
    if (!isMember) {
      reads.current += 1; // nothing in flight may bring a notice back
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a person who is no longer a member has no notice
      setSubscription(null);
      return;
    }
    void read();
    const stop = onBillingChanged(() => void read());
    return () => {
      stop();
      // a different member, or leaving: what is still in flight is for someone else
      reads.current += 1;
    };
  }, [isMember, userId, read]);

  const notice = subscription && pathname !== '/office/plan' ? billingNoticeOf(subscription) : null;
  if (!isMember || !subscription || notice === null) return <>{children}</>;

  const openPortal = async () => {
    setOpening(true);
    setPortalError(null);
    try {
      const { url } = await apiJson<{ url: string }>(PLANS_API.billingPortal, {
        method: 'POST',
        json: { officeId: subscription.officeId },
      });
      const destination = httpsUrlOrNull(url);
      if (destination === null) throw new ApiError('BILLING_PORTAL_FAILED');
      window.location.assign(destination);
    } catch (error: unknown) {
      setOpening(false);
      setPortalError(apiErrorMessage(error));
    }
  };

  if (notice === 'pastDue') {
    return (
      <ShellBanner
        severity="warning"
        role="alert"
        title={t('pastDue.title')}
        action={
          <BusyButton
            variant="outlined"
            color="inherit"
            busy={opening}
            busyLabel={t('pastDue.opening')}
            onClick={() => void openPortal()}
          >
            {t('pastDue.action')}
          </BusyButton>
        }
      >
        {portalError ?? t('pastDue.text')}
      </ShellBanner>
    );
  }

  const toPlan = (
    <Button component={Link} href="/office/plan" variant="outlined" color="inherit">
      {t(`${notice}.action`)}
    </Button>
  );
  if (notice === 'grace') {
    return (
      <ShellBanner
        severity="warning"
        title={t.rich('grace.title', {
          ended: () => <DateText value={subscription.lapsedAt ?? ''} />,
        })}
        action={toPlan}
      >
        {t.rich('grace.text', {
          readonly: () => <DateText value={subscription.readOnlyAt ?? ''} />,
        })}
      </ShellBanner>
    );
  }
  return (
    <ShellBanner severity="error" role="alert" title={t('readOnly.title')} action={toPlan}>
      {t('readOnly.text')}
    </ShellBanner>
  );
}
