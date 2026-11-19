'use client';

import ArrowDownwardOutlined from '@mui/icons-material/ArrowDownwardOutlined';
import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import VerifiedUserOutlined from '@mui/icons-material/VerifiedUserOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Skeleton from '@mui/material/Skeleton';
import Snackbar from '@mui/material/Snackbar';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@mui/utils';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import BusyButton from '@/app/components/patterns/BusyButton';
import DateText from '@/app/components/patterns/DateText';
import EmptyState from '@/app/components/patterns/EmptyState';
import ErrorState from '@/app/components/patterns/ErrorState';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import Money from '@/app/components/patterns/Money';
import PageHeader from '@/app/components/patterns/PageHeader';
import PageShell from '@/app/components/patterns/PageShell';
import StatusBadge from '@/app/components/patterns/StatusBadge';
import { useAuth } from '@/app/contexts/AuthContext';
import { apiJson } from '@/lib/api-client';
import { ApiError, useApiErrorMessage } from '@/lib/api-error';
import { notifyBillingChanged } from '@/lib/billing-events';
import { httpsUrlOrNull } from '@/lib/safe-url';
import ChangePlanDialog, { type PlanChangeResult } from './ChangePlanDialog';
import PlanCard from './PlanCard';
import {
  PLANS_API,
  isInEffect,
  type CatalogPlan,
  type OfficeSubscription,
  type PlansResponse,
} from './plans-api';
import { useApiResource } from './use-api-resource';

// SPEC-012 frame set 1. Where the visitor stands decides the cards' calls to action:
//   visitor   - signed out: the catalogue, "Entrar para assinar" (BR-012-05)
//   signed    - signed in, no office: "Assinar" opens the hosted checkout (BR-012-07)
//   member    - a member of an office with a plan in effect: "Mudar para este plano" (BR-012-16/17)
//   lapsed    - an office whose plan ended: "Assinar novamente" (BR-012-21)
type Variant = 'visitor' | 'signed' | 'member' | 'lapsed';

/** After "Entrar para assinar" the sign-in brings the visitor back here. */
const SIGN_IN_HREF = '/login?next=%2Fplans';

function Skeletons() {
  const t = useTranslations('plans');
  return (
    <Box
      aria-busy="true"
      sx={{
        display: 'grid',
        gap: 3,
        gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
      }}
    >
      <Box component="span" role="status" sx={visuallyHidden}>
        {t('loading')}
      </Box>
      {[0, 1, 2].map((index) => (
        <Card
          key={index}
          aria-hidden
          sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Skeleton variant="rounded" height={26} width="55%" />
          <Skeleton variant="rounded" height={36} width="70%" />
          <Skeleton variant="rounded" height={20} width="60%" />
          <Skeleton variant="rounded" height={44} />
        </Card>
      ))}
    </Box>
  );
}

export default function PlansPage() {
  const t = useTranslations('plans');
  const apiErrorMessage = useApiErrorMessage();
  const { loading: authLoading, isAuthenticated, personas } = useAuth();
  const isMember = isAuthenticated && personas.includes('advisor');

  const catalogue = useApiResource<PlansResponse>(PLANS_API.plans);
  // the office's plan is read only for an office member; everyone else has none (BR-012-07)
  const office = useApiResource<OfficeSubscription>(
    isMember && !authLoading ? PLANS_API.subscription : null,
  );

  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [changeFor, setChangeFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const retry = () => {
    void catalogue.reload();
    void office.reload();
  };

  const subscribe = async (planCode: string, officeId?: string) => {
    setCheckoutError(null);
    setBusyCode(planCode);
    try {
      const { url } = await apiJson<{ url: string }>(PLANS_API.checkout, {
        method: 'POST',
        json: officeId === undefined ? { planCode } : { planCode, officeId },
      });
      // the hosted page of the provider: the card is never typed here (BR-012-10). Only an https
      // URL is followed; the button stays busy until the browser leaves.
      const destination = httpsUrlOrNull(url);
      if (destination === null) throw new ApiError('CHECKOUT_SESSION_FAILED');
      window.location.assign(destination);
    } catch (error: unknown) {
      setBusyCode(null);
      setCheckoutError({
        code: error instanceof ApiError ? error.code : 'UNKNOWN',
        message: apiErrorMessage(error),
      });
    }
  };

  const changed = ({ change, targetName }: PlanChangeResult) => {
    setChangeFor(null);
    setToast(t(change === 'upgrade' ? 'toast.upgrade' : 'toast.scheduled', { name: targetName }));
    notifyBillingChanged();
    void office.reload({ quiet: true });
  };

  // ---- what to show while the data is not there --------------------------------------------
  const header = (summary: string) => <PageHeader title={t('title')} summary={summary} />;

  const failure =
    catalogue.state.name === 'error'
      ? catalogue.state.error
      : office.state.name === 'error' &&
          !(
            office.state.error instanceof ApiError &&
            office.state.error.code === 'SUBSCRIPTION_NOT_FOUND'
          )
        ? office.state.error
        : null;
  const loading =
    authLoading ||
    catalogue.state.name === 'loading' ||
    catalogue.state.name === 'idle' ||
    office.state.name === 'loading' ||
    // auth just resolved: the office read starts in an effect, one render later
    (isMember && office.state.name === 'idle');

  if (failure !== null) {
    return (
      <PageShell width="app">
        {header(t(isMember ? 'subtitle.member' : 'subtitle.public'))}
        <ErrorState
          title={t('error.title')}
          message={apiErrorMessage(failure)}
          code={failure instanceof ApiError ? failure.code : undefined}
          onRetry={retry}
        />
      </PageShell>
    );
  }
  if (loading || catalogue.state.name !== 'ready') {
    return (
      <PageShell width="app">
        {header(t(isMember ? 'subtitle.member' : 'subtitle.public'))}
        <Skeletons />
      </PageShell>
    );
  }

  const { items: plans, refundWindowDays } = catalogue.state.data;
  const subscription = office.state.name === 'ready' ? office.state.data : null;
  const variant: Variant = !isAuthenticated
    ? 'visitor'
    : subscription === null
      ? 'signed'
      : isInEffect(subscription.status)
        ? 'member'
        : 'lapsed';

  if (plans.length === 0) {
    return (
      <PageShell width="app">
        {header(t('subtitle.public'))}
        <EmptyState
          icon={Inventory2Outlined}
          title={t('empty.title')}
          description={t('empty.description')}
          actions={
            <Button component={Link} href="/search" variant="outlined">
              {t('empty.action')}
            </Button>
          }
        />
      </PageShell>
    );
  }

  // BR-012-04: the office's plan may have left the catalogue; it is still the office's plan
  const currentPlan =
    variant === 'member' && subscription
      ? plans.find((plan) => plan.code === subscription.plan.code)
      : undefined;
  const canceling = variant === 'member' && subscription?.cancelAtPeriodEnd === true;

  const hintFor = (plan: CatalogPlan) => {
    if (variant !== 'member' || !subscription || plan.code === subscription.plan.code)
      return undefined;
    if (subscription.scheduledChange?.planCode === plan.code) {
      return { icon: InfoOutlined, text: t('hint.scheduled') };
    }
    if (plan.activeJourneyLimit > subscription.activeJourneyLimit) {
      return { icon: ArrowUpwardOutlined, text: t('hint.upgrade') };
    }
    return {
      icon: ArrowDownwardOutlined,
      text: subscription.currentPeriodEnd
        ? t.rich('hint.downgradeOn', {
            date: () => <DateText value={subscription.currentPeriodEnd ?? ''} />,
          })
        : t('hint.downgrade'),
    };
  };

  const actionFor = (plan: CatalogPlan, headingId: string): ReactNode => {
    const busy = busyCode === plan.code;
    const other = busyCode !== null && !busy;
    if (variant === 'visitor') {
      return (
        <Button
          component={Link}
          href={SIGN_IN_HREF}
          variant="contained"
          fullWidth
          aria-describedby={headingId}
        >
          {t('cta.signIn')}
        </Button>
      );
    }
    if (variant === 'signed' || variant === 'lapsed') {
      return (
        <BusyButton
          variant="contained"
          fullWidth
          aria-describedby={headingId}
          busy={busy}
          busyLabel={t('cta.opening')}
          disabled={other}
          onClick={() => void subscribe(plan.code, subscription?.officeId)}
        >
          {t(variant === 'lapsed' ? 'cta.subscribeAgain' : 'cta.subscribe')}
        </BusyButton>
      );
    }
    // member
    if (plan.code === subscription?.plan.code || canceling) {
      return (
        <Button
          component={Link}
          href="/office/plan"
          variant="outlined"
          fullWidth
          aria-describedby={headingId}
        >
          {t('cta.viewOffice')}
        </Button>
      );
    }
    return (
      <Button
        variant="outlined"
        fullWidth
        aria-describedby={headingId}
        onClick={() => setChangeFor(plan.code)}
      >
        {t('cta.change')}
      </Button>
    );
  };

  return (
    <>
      <PageShell width="app">
        {header(
          t(variant === 'visitor' || variant === 'signed' ? 'subtitle.public' : 'subtitle.member'),
        )}

        {subscription && variant === 'member' ? (
          <Card sx={{ p: { xs: 2, sm: 3 } }}>
            <Box
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                justifyContent: 'space-between',
                alignItems: { xs: 'stretch', sm: 'center' },
                gap: 2,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="overline" sx={{ color: 'text.secondary' }} component="p">
                  {t('summary.label')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="h4" component="p">
                    {subscription.plan.name}
                  </Typography>
                  <StatusBadge
                    status={subscription.status === 'PAST_DUE' ? 'late' : 'onTime'}
                    label={t(
                      subscription.status === 'PAST_DUE'
                        ? 'status.pastDue'
                        : subscription.cancelAtPeriodEnd
                          ? 'status.canceling'
                          : 'status.active',
                    )}
                  />
                </Box>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {currentPlan
                    ? t('summary.journeys', { count: subscription.activeJourneyLimit })
                    : t.rich('summary.withdrawn', {
                        price: () => <Money value={subscription.plan.price} />,
                        interval: subscription.plan.interval,
                        count: subscription.activeJourneyLimit,
                      })}
                </Typography>
              </Box>
              <Button component={Link} href="/office/plan" variant="outlined">
                {t('cta.viewOffice')}
              </Button>
            </Box>
          </Card>
        ) : null}

        {variant === 'lapsed' && subscription?.lapsedAt ? (
          <InlineAlert
            severity="warning"
            title={t.rich('lapsed.title', {
              date: () => <DateText value={subscription.lapsedAt ?? ''} />,
            })}
          >
            {t('lapsed.text')}
          </InlineAlert>
        ) : null}

        {checkoutError ? (
          <InlineAlert severity="error" role="alert" title={t('checkoutError.title')}>
            {checkoutError.code === 'CHECKOUT_SESSION_FAILED'
              ? t('checkoutError.failed')
              : checkoutError.message}
          </InlineAlert>
        ) : null}

        <InlineAlert severity="info" icon={<VerifiedUserOutlined fontSize="inherit" />}>
          {t('refundNotice', { days: refundWindowDays })}
        </InlineAlert>

        <Box
          component="section"
          aria-label={t('list.label')}
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
          }}
        >
          {plans.map((plan) => (
            <PlanCard
              key={plan.code}
              name={plan.name}
              price={plan.price}
              interval={plan.interval}
              activeJourneyLimit={plan.activeJourneyLimit}
              current={plan.code === currentPlan?.code}
              hint={
                plan.code === currentPlan?.code
                  ? { icon: InfoOutlined, text: t('hint.currentPlan') }
                  : canceling
                    ? undefined
                    : hintFor(plan)
              }
              action={(headingId) => actionFor(plan, headingId)}
            />
          ))}
        </Box>

        <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
          {t('footnote')}
        </Typography>
      </PageShell>

      {variant === 'member' && subscription ? (
        <ChangePlanDialog
          open={changeFor !== null}
          onClose={() => setChangeFor(null)}
          plans={plans}
          subscription={subscription}
          initialPlanCode={changeFor}
          onChanged={changed}
        />
      ) : null}

      <Snackbar open={toast !== null} autoHideDuration={6000} onClose={() => setToast(null)}>
        <Alert severity="success" onClose={() => setToast(null)}>
          {toast}
        </Alert>
      </Snackbar>
    </>
  );
}
