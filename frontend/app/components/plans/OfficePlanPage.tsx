'use client';

import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import CreditCardOutlined from '@mui/icons-material/CreditCardOutlined';
import EventOutlined from '@mui/icons-material/EventOutlined';
import EventRepeatOutlined from '@mui/icons-material/EventRepeatOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import SwapVertOutlined from '@mui/icons-material/SwapVertOutlined';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
import UndoOutlined from '@mui/icons-material/UndoOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import Snackbar from '@mui/material/Snackbar';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@mui/utils';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import BusyButton from '@/app/components/patterns/BusyButton';
import ConfirmDialog from '@/app/components/patterns/ConfirmDialog';
import DateText from '@/app/components/patterns/DateText';
import EmptyState from '@/app/components/patterns/EmptyState';
import ErrorState from '@/app/components/patterns/ErrorState';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import KeyFactsGrid, { type KeyFact } from '@/app/components/patterns/KeyFactsGrid';
import Money from '@/app/components/patterns/Money';
import PageHeader from '@/app/components/patterns/PageHeader';
import PageShell from '@/app/components/patterns/PageShell';
import ProgressBar from '@/app/components/patterns/ProgressBar';
import StatusBadge, { type Status } from '@/app/components/patterns/StatusBadge';
import { apiJson } from '@/lib/api-client';
import { ApiError, useApiErrorMessage } from '@/lib/api-error';
import { notifyBillingChanged } from '@/lib/billing-events';
import { httpsUrlOrNull } from '@/lib/safe-url';
import BillingHistory from './BillingHistory';
import ChangePlanDialog, { type PlanChangeResult } from './ChangePlanDialog';
import JourneyLimitAlert from './JourneyLimitAlert';
import { PLANS_API, isInEffect, type OfficeSubscription, type PlansResponse } from './plans-api';
import { useApiResource } from './use-api-resource';

/** An upgrade is paid before it applies (BR-012-16): how often and how long the page looks again. */
export const UPGRADE_POLL_INTERVAL_MS = 5000;
export const UPGRADE_MAX_WAIT_MS = 120_000;

interface PendingUpgrade {
  code: string;
  name: string;
  limit: number;
  startedAt: number;
}

type Notice = { kind: 'success' | 'error'; message: string };

/** The office has no plan to show: not a member (SPEC-011), or it never paid (BR-012-07). */
const isNoOffice = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.code === 'FORBIDDEN' || error.code === 'SUBSCRIPTION_NOT_FOUND');

function Skeletons() {
  const t = useTranslations('officePlan');
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} aria-busy="true">
      <Box component="span" role="status" sx={visuallyHidden}>
        {t('loading')}
      </Box>
      <Card
        aria-hidden
        sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 3 }}
      >
        <Skeleton variant="rounded" height={28} width="40%" />
        <Skeleton variant="rounded" height={20} width="65%" />
        <Skeleton variant="rounded" height={8} />
        <Skeleton variant="rounded" height={44} />
      </Card>
      <Card
        aria-hidden
        sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} variant="rounded" height={44} />
        ))}
      </Card>
    </Box>
  );
}

/**
 * SPEC-012 frame set 3: the office's plan, inside the shell, for any current member (BR-012-11):
 * the plan and its state, the journeys in progress against the limit (BR-012-26), the next charge
 * and the billing history (BR-012-11, BR-012-15), changing the plan (BR-012-16..18), updating the
 * payment method (BR-012-10), and cancelling (BR-012-19, BR-012-29). Every action asks the API and
 * shows what it answered: nothing here sets a state (BR-012-14).
 */
export default function OfficePlanPage() {
  const t = useTranslations('officePlan');
  const apiErrorMessage = useApiErrorMessage();
  const office = useApiResource<OfficeSubscription>(PLANS_API.subscription);
  const catalogue = useApiResource<PlansResponse>(PLANS_API.plans);

  const [changeOpen, setChangeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState<'cancel' | 'undoCancel' | 'undoChange' | 'portal' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUpgrade | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const subscription = office.state.name === 'ready' ? office.state.data : null;

  // BR-012-16: after an upgrade the answer can still show the old plan until the prorated payment
  // is confirmed; the page looks again, for a bounded time, and says so meanwhile
  const pendingCode = pending?.code ?? null;
  const planCode = subscription?.plan.code ?? null;
  useEffect(() => {
    if (pending === null) return;
    if (planCode === pending.code) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the awaited plan arrived
      setPending(null);
      setHistoryKey((key) => key + 1);
      notifyBillingChanged();
      return;
    }
    const timer = setInterval(() => {
      if (Date.now() - pending.startedAt >= UPGRADE_MAX_WAIT_MS) setPending(null);
      else office.reload({ quiet: true });
    }, UPGRADE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
    // `pending` and `planCode` are what decide; `office.reload` is stable for the path
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCode, planCode]);

  const act = async (
    name: NonNullable<typeof busy>,
    path: string,
    json: Record<string, unknown>,
    success: string | null,
  ) => {
    setBusy(name);
    setActionError(null);
    try {
      await apiJson<unknown>(path, { method: 'POST', json });
      if (success) setNotice({ kind: 'success', message: success });
      setHistoryKey((key) => key + 1);
      notifyBillingChanged();
      office.reload({ quiet: true });
      return true;
    } catch (error: unknown) {
      setActionError(apiErrorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    if (!subscription) return;
    setBusy('portal');
    setActionError(null);
    try {
      const { url } = await apiJson<{ url: string }>(PLANS_API.billingPortal, {
        method: 'POST',
        json: { officeId: subscription.officeId },
      });
      // the provider's page for the payment method; it returns here (BR-012-10). Busy until it leaves.
      const destination = httpsUrlOrNull(url);
      if (destination === null) throw new ApiError('BILLING_PORTAL_FAILED');
      window.location.assign(destination);
    } catch (error: unknown) {
      setBusy(null);
      setNotice({ kind: 'error', message: apiErrorMessage(error) });
    }
  };

  const changed = ({
    subscription: view,
    change,
    targetCode,
    targetName,
    targetLimit,
  }: PlanChangeResult) => {
    setChangeOpen(false);
    setNotice({
      kind: 'success',
      message: t(change === 'upgrade' ? 'toast.changeUpgrade' : 'toast.changeScheduled', {
        name: targetName,
      }),
    });
    setHistoryKey((key) => key + 1);
    notifyBillingChanged();
    // the provider changes the price only once the prorated amount is paid
    if (change === 'upgrade' && view.plan.code !== targetCode) {
      setPending({ code: targetCode, name: targetName, limit: targetLimit, startedAt: Date.now() });
    }
    office.reload({ quiet: true });
  };

  // ---- the states of the data ------------------------------------------------------------------
  const header = (actions?: ReactNode) => <PageHeader title={t('title')} actions={actions} />;

  if (office.state.name === 'error' && isNoOffice(office.state.error)) {
    return (
      <PageShell width="app">
        {header()}
        <EmptyState
          icon={ApartmentOutlined}
          title={t('empty.title')}
          description={t('empty.description')}
          actions={
            <Button component={Link} href="/plans" variant="contained">
              {t('empty.action')}
            </Button>
          }
        />
      </PageShell>
    );
  }
  if (office.state.name === 'error') {
    return (
      <PageShell width="app">
        {header()}
        <ErrorState
          title={t('error.title')}
          message={apiErrorMessage(office.state.error)}
          code={office.state.error instanceof ApiError ? office.state.error.code : undefined}
          onRetry={() => office.reload()}
        />
      </PageShell>
    );
  }
  if (subscription === null) {
    return (
      <PageShell width="app">
        {header()}
        <Skeletons />
      </PageShell>
    );
  }

  // ---- what the plan is ------------------------------------------------------------------------
  const s = subscription;
  const inEffect = isInEffect(s.status);
  const lapsed = s.status === 'LAPSED';
  const readOnly = lapsed && s.readOnly;
  const pastDue = s.status === 'PAST_DUE';
  const canceling = s.status === 'CANCELING' || (inEffect && s.cancelAtPeriodEnd);
  const full = inEffect && s.activeJourneyLimit > 0 && s.inProgress >= s.activeJourneyLimit;
  const badge: { tone: Status; label: string } = lapsed
    ? { tone: 'cancelled', label: t('status.lapsed') }
    : pastDue
      ? { tone: 'late', label: t('status.pastDue') }
      : canceling
        ? { tone: 'neutral', label: t('status.canceling') }
        : { tone: 'onTime', label: t('status.active') };
  const canChange = inEffect && !canceling;
  const refundNow = s.refundEligibleUntil !== null;

  const changeButton = (variant: 'contained' | 'outlined') => (
    <Button
      variant={variant}
      startIcon={<SwapVertOutlined />}
      disabled={pending !== null || catalogue.state.name !== 'ready'}
      onClick={() => setChangeOpen(true)}
    >
      {t('actions.change')}
    </Button>
  );
  const paymentButton = (variant: 'contained' | 'outlined') => (
    <BusyButton
      variant={variant}
      startIcon={<CreditCardOutlined />}
      busy={busy === 'portal'}
      busyLabel={t('actions.paymentOpening')}
      onClick={() => void openPortal()}
    >
      {t('actions.payment')}
    </BusyButton>
  );
  const actions = lapsed ? undefined : canceling ? undefined : (
    <>
      {changeButton(pastDue ? 'outlined' : 'contained')}
      {paymentButton('outlined')}
    </>
  );

  const date = (value: string | null): ReactNode => (value ? <DateText value={value} /> : null);
  const periodRange =
    s.currentPeriodStart && s.currentPeriodEnd
      ? t.rich('facts.periodRange', {
          start: () => <DateText value={s.currentPeriodStart ?? ''} />,
          end: () => <DateText value={s.currentPeriodEnd ?? ''} />,
        })
      : null;
  const since = s.firstPaidAt
    ? { id: 'since', label: t('facts.since'), value: date(s.firstPaidAt) }
    : null;
  const facts: KeyFact[] = (
    lapsed
      ? [
          { id: 'ended', label: t('facts.endedAt'), value: date(s.lapsedAt) },
          s.readOnlyAt
            ? {
                id: 'readOnly',
                label: t(readOnly ? 'facts.readOnlySince' : 'facts.readOnlyFrom'),
                value: date(s.readOnlyAt),
              }
            : null,
          since,
        ]
      : pastDue
        ? [
            s.nextChargeAmount
              ? {
                  id: 'amount',
                  label: t('facts.pendingAmount'),
                  value: <Money value={s.nextChargeAmount} />,
                }
              : null,
            since,
            periodRange ? { id: 'period', label: t('facts.period'), value: periodRange } : null,
          ]
        : canceling
          ? [
              { id: 'until', label: t('facts.activeUntil'), value: date(s.currentPeriodEnd) },
              { id: 'next', label: t('facts.nextCharge'), value: t('facts.noCharge') },
              since,
              periodRange ? { id: 'period', label: t('facts.period'), value: periodRange } : null,
            ]
          : [
              s.currentPeriodEnd
                ? { id: 'next', label: t('facts.nextCharge'), value: date(s.currentPeriodEnd) }
                : null,
              s.nextChargeAmount
                ? {
                    id: 'amount',
                    label: t('facts.nextAmount'),
                    value: <Money value={s.nextChargeAmount} />,
                  }
                : null,
              since,
              periodRange ? { id: 'period', label: t('facts.period'), value: periodRange } : null,
            ]
  ).filter((fact): fact is KeyFact => fact !== null);

  // ---- notices on the plan card ----------------------------------------------------------------
  const notices: ReactNode[] = [];
  if (pending !== null) {
    notices.push(
      <InlineAlert
        key="upgrading"
        severity="info"
        role="status"
        icon={<SyncOutlined fontSize="inherit" />}
        title={t('upgrading.title', { name: pending.name })}
      >
        {t('upgrading.text', { limit: pending.limit })}
      </InlineAlert>,
    );
  }
  if (s.scheduledChange && inEffect && !canceling) {
    const next = s.scheduledChange;
    notices.push(
      <InlineAlert
        key="scheduled"
        severity="info"
        icon={<EventRepeatOutlined fontSize="inherit" />}
        title={
          next.at
            ? t.rich('scheduled.title', {
                name: next.planName,
                date: () => <DateText value={next.at ?? ''} />,
              })
            : t('scheduled.titleNoDate', { name: next.planName })
        }
        action={
          s.canUndoScheduledChange ? (
            <BusyButton
              variant="outlined"
              color="inherit"
              startIcon={<UndoOutlined />}
              busy={busy === 'undoChange'}
              busyLabel={t('actions.undoChangeBusy')}
              onClick={() =>
                void act(
                  'undoChange',
                  PLANS_API.change,
                  { planCode: s.plan.code, officeId: s.officeId },
                  t('toast.changeUndone'),
                )
              }
            >
              {t('actions.undoChange')}
            </BusyButton>
          ) : undefined
        }
      >
        {t('scheduled.text', { current: s.plan.name, limit: s.activeJourneyLimit })}
        {s.inProgress >= next.activeJourneyLimit
          ? ` ${t('scheduled.belowCount', { inProgress: s.inProgress, next: next.activeJourneyLimit })}`
          : ''}
      </InlineAlert>,
    );
  }
  if (full) {
    notices.push(
      <JourneyLimitAlert
        key="limit"
        inProgress={s.inProgress}
        limit={s.activeJourneyLimit}
        action={canChange ? changeButton('outlined') : undefined}
      />,
    );
  }

  // ---- the alert above the card, by state ------------------------------------------------------
  let alert: ReactNode = null;
  if (pastDue) {
    alert = (
      <InlineAlert
        severity="warning"
        role="alert"
        title={
          s.currentPeriodStart
            ? t.rich('pastDue.title', {
                date: () => <DateText value={s.currentPeriodStart ?? ''} />,
              })
            : t('pastDue.titleNoDate')
        }
        action={paymentButton('contained')}
      >
        {t('pastDue.text')}
      </InlineAlert>
    );
  } else if (canceling) {
    alert = (
      <InlineAlert
        severity="info"
        title={t('canceling.title')}
        action={
          s.canUndoCancel ? (
            <BusyButton
              variant="contained"
              startIcon={<UndoOutlined />}
              busy={busy === 'undoCancel'}
              busyLabel={t('actions.undoCancelBusy')}
              onClick={() =>
                void act(
                  'undoCancel',
                  PLANS_API.undoCancel,
                  { officeId: s.officeId },
                  t('toast.cancelUndone'),
                )
              }
            >
              {t('actions.undoCancel')}
            </BusyButton>
          ) : undefined
        }
      >
        {t.rich(s.canUndoCancel ? 'canceling.text' : 'canceling.textExpired', {
          date: () => <DateText value={s.currentPeriodEnd ?? ''} />,
        })}
      </InlineAlert>
    );
  } else if (lapsed && readOnly) {
    alert = (
      <InlineAlert
        severity="error"
        role="alert"
        icon={<LockOutlined fontSize="inherit" />}
        title={t('readOnly.title')}
        action={
          <Button component={Link} href="/plans" variant="contained">
            {t('actions.resubscribe')}
          </Button>
        }
      >
        {t.rich('readOnly.text', {
          days: s.graceDays,
          ended: () => <DateText value={s.lapsedAt ?? ''} />,
          readonly: () => <DateText value={s.readOnlyAt ?? ''} />,
        })}
      </InlineAlert>
    );
  } else if (lapsed) {
    alert = (
      <InlineAlert
        severity="warning"
        role="alert"
        title={t.rich('grace.title', {
          ended: () => <DateText value={s.lapsedAt ?? ''} />,
          readonly: () => <DateText value={s.readOnlyAt ?? ''} />,
        })}
        action={
          <Button component={Link} href="/plans" variant="contained">
            {t('actions.resubscribe')}
          </Button>
        }
      >
        {t('grace.text')}
      </InlineAlert>
    );
  }

  const free = Math.max(s.activeJourneyLimit - s.inProgress, 0);

  return (
    <>
      <PageShell width="app">
        {header(actions)}

        {actionError ? (
          <InlineAlert severity="error" role="alert" title={t('actionError.title')}>
            {actionError}
          </InlineAlert>
        ) : null}
        {alert}

        <Card
          component="section"
          aria-labelledby="office-plan-name"
          sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 3 }}
        >
          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
              alignItems: 'start',
            }}
          >
            <Box>
              <Typography variant="overline" component="p" sx={{ color: 'text.secondary' }}>
                {t(lapsed ? 'current.lastLabel' : 'current.label')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography id="office-plan-name" variant="h3" component="h2">
                  {s.plan.name}
                </Typography>
                <StatusBadge status={badge.tone} label={badge.label} />
              </Box>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                {lapsed
                  ? t('current.lastPlan', { name: s.plan.name })
                  : t.rich('current.price', {
                      price: () => <Money value={s.plan.price} />,
                      interval: s.plan.interval,
                      count: s.activeJourneyLimit,
                    })}
              </Typography>
            </Box>
            {s.activeJourneyLimit > 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 1,
                    flexWrap: 'wrap',
                  }}
                >
                  <Typography variant="subtitle1" component="p">
                    {t('usage.text', { inProgress: s.inProgress, limit: s.activeJourneyLimit })}
                  </Typography>
                  <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
                    {t('usage.free', { free })}
                  </Typography>
                </Box>
                <ProgressBar
                  value={s.inProgress}
                  max={s.activeJourneyLimit}
                  label={t('usage.label')}
                  valueText={t('usage.text', {
                    inProgress: s.inProgress,
                    limit: s.activeJourneyLimit,
                  })}
                  tone={full ? 'warning' : 'primary'}
                />
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Typography variant="subtitle1" component="p">
                  {t.rich('usage.lapsedCount', {
                    count: s.inProgress,
                    b: (chunks) => (
                      <Box component="strong" sx={{ fontWeight: 600 }}>
                        {chunks}
                      </Box>
                    ),
                  })}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t(readOnly ? 'usage.lapsedReadOnly' : 'usage.lapsedGrace')}
                </Typography>
              </Box>
            )}
          </Box>
          {notices.length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{notices}</Box>
          ) : null}
          <Divider />
          <KeyFactsGrid facts={facts} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('current.datesNote')}
          </Typography>
        </Card>

        <BillingHistory officeId={s.officeId} refreshKey={historyKey} />

        {inEffect && !canceling ? (
          <Card
            component="section"
            aria-labelledby="office-plan-cancel"
            sx={{ p: { xs: 2, sm: 3 } }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', sm: 'center' },
                gap: 2,
              }}
            >
              <Box sx={{ minWidth: 0, maxWidth: '60ch' }}>
                <Typography id="office-plan-cancel" variant="h4" component="h2">
                  {t('cancel.title')}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                  {refundNow
                    ? t('cancel.refundText', { days: s.refundWindowDays })
                    : s.currentPeriodEnd
                      ? t.rich('cancel.text', {
                          date: () => <DateText value={s.currentPeriodEnd ?? ''} />,
                        })
                      : t('cancel.textNoDate')}
                </Typography>
              </Box>
              <Button variant="outlined" color="destructive" onClick={() => setCancelOpen(true)}>
                {t('cancel.action')}
              </Button>
            </Box>
          </Card>
        ) : null}
      </PageShell>

      {catalogue.state.name === 'ready' && canChange ? (
        <ChangePlanDialog
          open={changeOpen}
          onClose={() => setChangeOpen(false)}
          plans={catalogue.state.data.items}
          subscription={s}
          onChanged={changed}
        />
      ) : null}

      <ConfirmDialog
        open={cancelOpen}
        busy={busy === 'cancel'}
        busyLabel={refundNow ? t('cancel.refund.confirming') : t('cancel.dialog.confirming')}
        title={
          refundNow ? t('cancel.refund.title') : t('cancel.dialog.title', { name: s.plan.name })
        }
        description={
          refundNow
            ? t.rich('cancel.refund.description', {
                date: () => <DateText value={s.firstPaidAt ?? ''} />,
                days: s.refundWindowDays,
                strong: (chunks) => <strong>{chunks}</strong>,
              })
            : s.currentPeriodEnd
              ? t.rich('cancel.dialog.description', {
                  date: () => <DateText value={s.currentPeriodEnd ?? ''} />,
                })
              : t('cancel.dialog.descriptionNoDate')
        }
        consequences={
          refundNow
            ? [
                { icon: BlockOutlined, text: t('cancel.refund.now') },
                { icon: ScheduleOutlined, text: t('cancel.refund.grace', { days: s.graceDays }) },
                { icon: Inventory2Outlined, text: t('cancel.dialog.kept') },
              ]
            : [
                {
                  icon: EventOutlined,
                  text: t('cancel.dialog.stays', { limit: s.activeJourneyLimit }),
                },
                { icon: BlockOutlined, text: t('cancel.dialog.after', { days: s.graceDays }) },
                { icon: Inventory2Outlined, text: t('cancel.dialog.kept') },
                { icon: PaymentsOutlined, text: t('cancel.dialog.noRefund') },
              ]
        }
        confirmLabel={refundNow ? t('cancel.refund.confirm') : t('cancel.dialog.confirm')}
        cancelLabel={t('cancel.dialog.keep')}
        onClose={() => setCancelOpen(false)}
        onConfirm={() =>
          void act(
            'cancel',
            PLANS_API.cancel,
            { officeId: s.officeId },
            t(refundNow ? 'toast.canceledRefund' : 'toast.canceled'),
          ).then((done) => {
            if (done) setCancelOpen(false);
          })
        }
      />

      <Snackbar open={notice !== null} autoHideDuration={6000} onClose={() => setNotice(null)}>
        <Alert severity={notice?.kind ?? 'success'} onClose={() => setNotice(null)}>
          {notice?.message}
        </Alert>
      </Snackbar>
    </>
  );
}
