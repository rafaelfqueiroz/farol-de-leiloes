'use client';

import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@mui/utils';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import BusyButton from '@/app/components/patterns/BusyButton';
import DateText from '@/app/components/patterns/DateText';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import Money from '@/app/components/patterns/Money';
import StatusBadge, { type Status } from '@/app/components/patterns/StatusBadge';
import { apiJson } from '@/lib/api-client';
import { useApiErrorMessage } from '@/lib/api-error';
import { PLANS_API, type Invoice, type InvoiceStatus, type InvoicesPage } from './plans-api';

/** BR-012-11, owner decision 12: the last six charges, then "Ver mais cobranças". */
export const HISTORY_PAGE_SIZE = 6;

const STATUS: Record<
  InvoiceStatus,
  { tone: Status; key: 'paid' | 'open' | 'failed' | 'void' | 'draft' }
> = {
  paid: { tone: 'onTime', key: 'paid' },
  open: { tone: 'neutral', key: 'open' },
  uncollectible: { tone: 'late', key: 'failed' },
  void: { tone: 'cancelled', key: 'void' },
  draft: { tone: 'neutral', key: 'draft' },
};

/** The date a charge is listed under: when it was paid, else the start of the period it charges. */
const dateOf = (invoice: Invoice): string | null => invoice.paidAt ?? invoice.periodStart;

type Load =
  | { name: 'loading' }
  | {
      name: 'ready';
      items: Invoice[];
      total: number;
      page: number;
      more: 'idle' | 'loading' | 'failed';
    }
  | { name: 'failed'; message: string };

export interface BillingHistoryProps {
  officeId: string;
  /** Changes when the plan was acted on (a change, a cancellation): the history is read again. */
  refreshKey: number;
}

/**
 * SPEC-012 BR-012-11, frame o1: the billing history, newest first, six rows and "Ver mais
 * cobranças" for the next page (the API pages it, AR-35). A table from `md`, cards below (DS-13).
 * The provider being unreadable breaks only this section (the plan page does not wait for it).
 */
export default function BillingHistory({ officeId, refreshKey }: BillingHistoryProps) {
  const t = useTranslations('officePlan.history');
  const apiErrorMessage = useApiErrorMessage();
  const headingId = useId();
  const [load, setLoad] = useState<Load>({ name: 'loading' });
  const reads = useRef(0);

  const read = useCallback(
    async (page: number, append: boolean) => {
      const mine = ++reads.current;
      const query = `?officeId=${encodeURIComponent(officeId)}&page=${page}&pageSize=${HISTORY_PAGE_SIZE}`;
      try {
        const answer = await apiJson<InvoicesPage>(`${PLANS_API.invoices}${query}`);
        if (reads.current !== mine) return;
        setLoad((before) => ({
          name: 'ready',
          items:
            append && before.name === 'ready' ? [...before.items, ...answer.items] : answer.items,
          total: answer.total,
          page: answer.page,
          more: 'idle',
        }));
      } catch (error: unknown) {
        if (reads.current !== mine) return;
        setLoad((before) =>
          append && before.name === 'ready'
            ? { ...before, more: 'failed' }
            : { name: 'failed', message: apiErrorMessage(error) },
        );
      }
    },
    [apiErrorMessage, officeId],
  );

  useEffect(() => {
    setLoad({ name: 'loading' });
    void read(1, false);
  }, [read, refreshKey]);

  let body: ReactNode;
  if (load.name === 'loading') {
    body = (
      <Card sx={{ p: 2 }} aria-busy="true">
        <Box component="span" role="status" sx={visuallyHidden}>
          {t('moreBusy')}
        </Box>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} variant="rounded" height={44} sx={{ mb: 1 }} />
        ))}
      </Card>
    );
  } else if (load.name === 'failed') {
    body = (
      <InlineAlert
        severity="error"
        role="alert"
        action={
          <Button variant="outlined" color="inherit" onClick={() => void read(1, false)}>
            {t('retry')}
          </Button>
        }
      >
        {load.message}
      </InlineAlert>
    );
  } else if (load.items.length === 0) {
    body = (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t('empty')}
      </Typography>
    );
  } else {
    const description = (invoice: Invoice): ReactNode => {
      if (invoice.reason === 'subscription_update') return t('proration');
      if (invoice.periodStart && invoice.periodEnd) {
        return t.rich('subscription', {
          start: () => <DateText value={invoice.periodStart ?? ''} />,
          end: () => <DateText value={invoice.periodEnd ?? ''} />,
        });
      }
      return invoice.reason === 'other' ? t('other') : t('subscriptionNoPeriod');
    };
    const link = (invoice: Invoice): ReactNode => {
      if (!invoice.hostedUrl) return null;
      const date = dateOf(invoice);
      return (
        <Link
          href={invoice.hostedUrl}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            minHeight: (theme) => theme.spacing(5.5),
          }}
        >
          {date
            ? t.rich('viewInvoiceOf', { date: () => <DateText value={date} /> })
            : t('viewInvoiceNoDate')}
          <OpenInNewOutlined aria-hidden fontSize="inherit" />
        </Link>
      );
    };
    const badge = (invoice: Invoice) => (
      <StatusBadge status={STATUS[invoice.status].tone} label={t(STATUS[invoice.status].key)} />
    );
    const date = (invoice: Invoice) => {
      const value = dateOf(invoice);
      return value ? <DateText value={value} /> : t('noDate');
    };
    body = (
      <>
        <Card sx={{ overflow: 'hidden', display: { xs: 'none', md: 'block' } }}>
          <Table aria-labelledby={headingId}>
            <TableHead sx={{ bgcolor: 'background.muted' }}>
              <TableRow>
                <TableCell>{t('columns.date')}</TableCell>
                <TableCell>{t('columns.description')}</TableCell>
                <TableCell align="right">{t('columns.amount')}</TableCell>
                <TableCell>{t('columns.status')}</TableCell>
                <TableCell>{t('columns.invoice')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {load.items.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{date(invoice)}</TableCell>
                  <TableCell>{description(invoice)}</TableCell>
                  <TableCell align="right">
                    <Money value={invoice.amount} />
                  </TableCell>
                  <TableCell>{badge(invoice)}</TableCell>
                  <TableCell>{link(invoice)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card sx={{ display: { xs: 'block', md: 'none' } }}>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {load.items.map((invoice) => (
              <Box
                component="li"
                key={invoice.id}
                sx={{
                  p: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  borderBottom: 1,
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 0 },
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="subtitle2" component="span">
                    {date(invoice)}
                  </Typography>
                  {badge(invoice)}
                </Box>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {description(invoice)}
                </Typography>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 1,
                  }}
                >
                  <Typography variant="subtitle1" component="span">
                    <Money value={invoice.amount} />
                  </Typography>
                  {link(invoice)}
                </Box>
              </Box>
            ))}
          </Box>
        </Card>
        {load.more === 'failed' ? (
          <InlineAlert severity="error" role="alert">
            {t('error')}
          </InlineAlert>
        ) : null}
        {load.items.length < load.total ? (
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <BusyButton
              variant="outlined"
              busy={load.more === 'loading'}
              busyLabel={t('moreBusy')}
              onClick={() => {
                setLoad({ ...load, more: 'loading' });
                void read(load.page + 1, true);
              }}
            >
              {t('more')}
            </BusyButton>
          </Box>
        ) : null}
      </>
    );
  }

  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
    >
      <Typography id={headingId} variant="h3" component="h2">
        {t('title')}
      </Typography>
      {body}
    </Box>
  );
}
