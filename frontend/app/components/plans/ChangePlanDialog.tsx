'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import BusyButton from '@/app/components/patterns/BusyButton';
import DateText from '@/app/components/patterns/DateText';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import Money from '@/app/components/patterns/Money';
import RadioOptionCard from '@/app/components/patterns/RadioOptionCard';
import StatusBadge from '@/app/components/patterns/StatusBadge';
import { apiJson } from '@/lib/api-client';
import { ApiError, useApiErrorMessage } from '@/lib/api-error';
import { absMoney, isPositiveMoney, sumMoney } from '@/lib/money';
import {
  PLANS_API,
  type CatalogPlan,
  type OfficeSubscription,
  type PlanChangeKind,
  type PlanChangePreview,
} from './plans-api';

export interface PlanChangeResult {
  subscription: OfficeSubscription;
  change: PlanChangeKind;
  targetCode: string;
  targetName: string;
  targetLimit: number;
}

export interface ChangePlanDialogProps {
  open: boolean;
  onClose: () => void;
  /** The plans offered now (withdrawn ones never come here, BR-012-04). */
  plans: readonly CatalogPlan[];
  subscription: OfficeSubscription;
  /** The option marked when the dialog opens ("Mudar para este plano" on /plans). */
  initialPlanCode?: string | null;
  onChanged: (result: PlanChangeResult) => void;
}

/** Never asked again sooner than this, whatever the quote says: a broken date must not loop. */
const MIN_QUOTE_LIFETIME_MS = 10_000;

type PreviewState =
  | { name: 'idle' }
  | { name: 'loading'; code: string }
  | { name: 'ready'; code: string; preview: PlanChangePreview }
  | { name: 'failed'; code: string; message: string };

/**
 * SPEC-012 frames 13 and 14: choose another offered plan. Choosing one asks the backend what it
 * would do and charge (`change-preview`, read only): an upgrade shows the provider's own prorated
 * amount (BR-012-16), a downgrade says when it starts (BR-012-17), and a limit below the journeys
 * in progress is explained, not blocked (BR-012-18). Confirming sends `change`; any member can
 * (BR-012-11).
 */
export default function ChangePlanDialog({
  open,
  onClose,
  plans,
  subscription,
  initialPlanCode = null,
  onChanged,
}: ChangePlanDialogProps) {
  const t = useTranslations('plans.change');
  const apiErrorMessage = useApiErrorMessage();
  const titleId = useId();
  const [selected, setSelected] = useState<string>('');
  const [preview, setPreview] = useState<PreviewState>({ name: 'idle' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // why the amount shown was asked for again (it expired, or it changed): said above the options
  const [refreshed, setRefreshed] = useState<'expired' | 'changed' | null>(null);
  // the newest preview request: an older answer that arrives late is ignored
  const requests = useRef(0);

  const choose = (code: string, again: 'expired' | 'changed' | null = null) => {
    setSelected(code);
    // a plan chosen by the member starts clean; a re-preview keeps the reason it was made
    if (again === null) setError(null);
    setRefreshed(again);
    const request = ++requests.current;
    setPreview({ name: 'loading', code });
    apiJson<PlanChangePreview>(PLANS_API.changePreview, {
      method: 'POST',
      json: { planCode: code, officeId: subscription.officeId },
    }).then(
      (answer) => {
        if (requests.current === request) setPreview({ name: 'ready', code, preview: answer });
      },
      (failure: unknown) => {
        if (requests.current === request) {
          setPreview({ name: 'failed', code, message: apiErrorMessage(failure) });
        }
      },
    );
  };

  // every opening starts from the plan the caller came for (or from nothing)
  useEffect(() => {
    if (!open) return;
    requests.current += 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the dialog's state restarts with each opening
    setError(null);
    setSaving(false);
    if (initialPlanCode && initialPlanCode !== subscription.plan.code) {
      choose(initialPlanCode);
    } else {
      setSelected('');
      setPreview({ name: 'idle' });
    }
    // `choose` closes over fresh state on purpose; only an opening restarts the dialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPlanCode]);

  const target = plans.find((plan) => plan.code === selected);
  const ready = preview.name === 'ready' && preview.code === selected ? preview.preview : null;

  const effectOf = (plan: CatalogPlan): ReactNode => {
    if (plan.code !== selected) return null;
    if (preview.name === 'loading') return t('calculating');
    if (preview.name === 'failed') return preview.message;
    if (!ready) return null;
    if (ready.change === 'keep') return t('effectKeep');
    const date = (): ReactNode =>
      ready.nextChargeAt === null ? null : <DateText value={ready.nextChargeAt} />;
    if (ready.change === 'upgrade') {
      const charge = sumMoney(
        ready.lines.filter((l) => isPositiveMoney(l.amount)).map((l) => l.amount),
      );
      const credit = absMoney(
        sumMoney(ready.lines.filter((l) => !isPositiveMoney(l.amount)).map((l) => l.amount)),
      );
      const due = (): ReactNode => <Money value={ready.amountDue} />;
      return (
        <>
          {!isPositiveMoney(ready.amountDue)
            ? t('effectUpgradeFree')
            : isPositiveMoney(credit)
              ? t.rich('effectUpgrade', {
                  due,
                  charge: () => <Money value={charge} />,
                  credit: () => <Money value={credit} />,
                })
              : t.rich('effectUpgradeSimple', { due })}{' '}
          {ready.nextChargeAt ? t.rich('nextCharge', { date }) : null} {t('providerCalculated')}
        </>
      );
    }
    if (ready.change === 'schedule') {
      return ready.effectiveAt
        ? t.rich('effectDowngrade', { date: () => <DateText value={ready.effectiveAt ?? ''} /> })
        : t('effectDowngradeNoDate');
    }
    return t('effectRelease');
  };

  // BR-012-18: below the count is allowed and explained
  const belowCount =
    ready?.change === 'schedule' && target && target.activeJourneyLimit <= subscription.inProgress;

  // BR-012-16: a quote is good for a short time. When it runs out the amount is asked for again and
  // the member confirms the new one; the old one can no longer be confirmed from the screen.
  const quote = ready?.quote ?? null;
  useEffect(() => {
    if (!open || quote === null || saving) return;
    const lifetime = Date.parse(quote.expiresAt) - Date.parse(quote.prorationDate);
    const timer = setTimeout(
      () => choose(quote.planCode, 'expired'),
      Math.max(lifetime, MIN_QUOTE_LIFETIME_MS),
    );
    return () => clearTimeout(timer);
    // the quote decides; `choose` closes over fresh state on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quote, saving]);

  const confirm = async () => {
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      const view = await apiJson<OfficeSubscription>(PLANS_API.change, {
        method: 'POST',
        json: {
          planCode: target.code,
          officeId: subscription.officeId,
          // an upgrade is confirmed with the quote it was shown; the server judges it again
          ...(quote === null
            ? {}
            : {
                quote: {
                  planCode: quote.planCode,
                  prorationDate: quote.prorationDate,
                  amountDue: quote.amountDue,
                  nextChargeDate: quote.nextChargeDate,
                },
              }),
        },
      });
      onChanged({
        subscription: view,
        change: ready?.change ?? 'upgrade',
        targetCode: target.code,
        targetName: target.name,
        targetLimit: target.activeJourneyLimit,
      });
    } catch (failure: unknown) {
      setError(apiErrorMessage(failure));
      // QUOTE_STALE: nothing was charged; the new amount is asked for and confirmed again
      if (failure instanceof ApiError && failure.code === 'QUOTE_STALE') {
        choose(target.code, 'changed');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={(_event, reason) => {
        if (!saving && reason !== 'backdropClick') onClose();
      }}
      aria-labelledby={titleId}
      fullWidth
      maxWidth="sm"
      scroll="paper"
    >
      <DialogTitle id={titleId} variant="h4" component="h2">
        {t('title')}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('current', {
              name: subscription.plan.name,
              count: subscription.activeJourneyLimit,
            })}
          </Typography>
          <FormControl component="fieldset" variant="standard">
            <FormLabel component="legend" sx={{ mb: 1 }}>
              {t('legend')}
            </FormLabel>
            <RadioGroup
              value={selected}
              onChange={(event) => choose(event.target.value)}
              sx={{ gap: 1.5 }}
            >
              {plans.map((plan) => {
                const isCurrent = plan.code === subscription.plan.code;
                return (
                  <RadioOptionCard
                    key={plan.code}
                    value={plan.code}
                    title={plan.name}
                    trailing={t.rich('optionPrice', {
                      price: () => <Money value={plan.price} />,
                      interval: plan.interval,
                    })}
                    description={t('limit', { count: plan.activeJourneyLimit })}
                    badge={
                      isCurrent ? <StatusBadge status="done" label={t('currentBadge')} /> : null
                    }
                    effect={effectOf(plan)}
                    disabled={isCurrent}
                  />
                );
              })}
            </RadioGroup>
          </FormControl>
          {belowCount && target ? (
            <InlineAlert severity="warning">
              {t('belowCount', {
                inProgress: subscription.inProgress,
                limit: target.activeJourneyLimit,
              })}
            </InlineAlert>
          ) : null}
          {refreshed === 'expired' ? (
            <InlineAlert severity="info" role="status">
              {t('quoteExpired')}
            </InlineAlert>
          ) : null}
          {error ? (
            <InlineAlert severity="error" role="alert">
              {error}
            </InlineAlert>
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button variant="outlined" onClick={onClose} disabled={saving}>
          {t('back')}
        </Button>
        <BusyButton
          variant="contained"
          busy={saving}
          busyLabel={t('confirming')}
          disabled={ready === null || ready.change === 'keep'}
          onClick={() => void confirm()}
        >
          {t('confirm')}
        </BusyButton>
      </DialogActions>
    </Dialog>
  );
}
