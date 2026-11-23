'use client';

import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import EventBusyOutlined from '@mui/icons-material/EventBusyOutlined';
import HourglassTopOutlined from '@mui/icons-material/HourglassTopOutlined';
import TaskOutlined from '@mui/icons-material/TaskOutlined';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@mui/utils';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import BusyButton from '@/app/components/patterns/BusyButton';
import DateText from '@/app/components/patterns/DateText';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import { apiFetch } from '@/lib/api-client';
import { readApiError, useApiErrorMessage } from '@/lib/api-error';
import { reportClientError } from '@/lib/report-client-error';
import { httpsUrlOrNull } from '@/lib/safe-url';
import {
  PRIVACY_API,
  dataExportSchema,
  downloadLinkSchema,
  exportsPageSchema,
  settleExpiry,
  type DataExport,
} from './privacy-api';
import PrivacySection from './PrivacySection';

/** How often a queued export is looked at again (BR-010-11: it is usually ready in minutes). */
export const EXPORT_POLL_INTERVAL_MS = 5000;
/** After this long the page stops looking by itself; the export is still being made (15 days at most). */
export const EXPORT_POLL_MAX_MS = 10 * 60 * 1000;

export interface ExportSectionProps {
  /** The account's newest export when the page loaded, or null. */
  initial: DataExport | null;
}

function ExportRow({
  icon,
  children,
  action,
}: {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      useFlexGap
      sx={{
        flexWrap: 'wrap',
        gap: 1.5,
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        py: 1.5,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.muted',
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
        {icon}
        <Stack spacing={0.5} sx={{ minWidth: 0 }}>
          {children}
        </Stack>
      </Stack>
      {action}
    </Stack>
  );
}

/**
 * SPEC-010 BR-010-09, BR-010-11 (frame "Exportar meus dados"): portability in a structured file,
 * with no manual work, only for the account itself, downloaded through a 60-second link and erased
 * after 7 days. States: none, "Preparando" (queued: looked at again every few seconds, announced in a
 * polite status region, and given up on after a while), "Arquivo pronto", "Não foi possível gerar" and
 * "Arquivo expirado". The link is opened by the BROWSER, only when it is https (`httpsUrlOrNull`),
 * and is never kept, shown or logged (SC-18).
 */
export default function ExportSection({ initial }: ExportSectionProps) {
  const t = useTranslations('privacy.export');
  const apiErrorMessage = useApiErrorMessage();
  const [current, setCurrent] = useState<DataExport | null>(initial);
  const [requesting, setRequesting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const queued = current?.status === 'queued';

  // Looks at the newest export again while it is queued. Stops when it leaves `queued`, when the
  // page goes away, and after EXPORT_POLL_MAX_MS. A failed look is not shown: the next one tries again.
  const startedAt = useRef<number | null>(null);
  const look = useCallback(async (): Promise<DataExport | null | undefined> => {
    try {
      const response = await apiFetch(PRIVACY_API.latestExport);
      if (!response.ok) return undefined;
      const page = exportsPageSchema.safeParse(await response.json());
      return page.success
        ? settleExpiry(page.data.items[0] ?? null, response.headers.get('date'))
        : undefined;
    } catch (error: unknown) {
      reportClientError(error, { where: 'ExportSection poll' });
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!queued) {
      startedAt.current = null;
      return;
    }
    startedAt.current ??= Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (cancelled) return;
      if (startedAt.current !== null && Date.now() - startedAt.current >= EXPORT_POLL_MAX_MS) {
        setSlow(true);
        return;
      }
      const latest = await look();
      if (cancelled) return;
      if (latest) setCurrent(latest);
      if (latest && latest.status !== 'queued') return;
      timer = setTimeout(() => void tick(), EXPORT_POLL_INTERVAL_MS);
    };
    timer = setTimeout(() => void tick(), EXPORT_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [queued, look]);

  const request = async () => {
    if (requesting) return;
    setRequesting(true);
    setFailure(null);
    setSlow(false);
    try {
      const response = await apiFetch(PRIVACY_API.exports, { method: 'POST' });
      if (!response.ok) {
        setFailure(apiErrorMessage(await readApiError(response)));
        return;
      }
      const parsed = dataExportSchema.safeParse(await response.json());
      if (parsed.success) {
        startedAt.current = null;
        setCurrent(parsed.data);
      }
    } catch (error: unknown) {
      reportClientError(error, { where: 'ExportSection request' });
      setFailure(apiErrorMessage(error));
    } finally {
      setRequesting(false);
    }
  };

  const download = async () => {
    if (!current || downloading) return;
    setDownloading(true);
    setFailure(null);
    try {
      const response = await apiFetch(PRIVACY_API.download(current.id));
      if (!response.ok) {
        const error = await readApiError(response);
        if (error.code === 'EXPORT_EXPIRED') {
          // the server says it is past its time, though the list still calls it ready until the
          // cleanup runs: it is expired here, with the replacement action (BR-010-11)
          setCurrent({ ...current, status: 'expired' });
          return;
        }
        setFailure(apiErrorMessage(error));
        // the file was never made or is gone: look again at what the account has now
        if (error.code === 'NOT_FOUND') {
          const latest = await look();
          if (latest !== undefined) setCurrent(latest);
        }
        return;
      }
      const link = downloadLinkSchema.safeParse(await response.json());
      const url = link.success ? httpsUrlOrNull(link.data.url) : null;
      if (url === null) {
        setFailure(t('downloadFailed'));
        return;
      }
      // the BROWSER goes to the 60-second link, in its own tab; nothing keeps or shows it (SC-18)
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.click();
    } catch (error: unknown) {
      reportClientError(error, { where: 'ExportSection download' });
      setFailure(apiErrorMessage(error));
    } finally {
      setDownloading(false);
    }
  };

  const requestButton = (label: string, variant: 'contained' | 'outlined') => (
    <BusyButton
      variant={variant}
      busy={requesting}
      busyLabel={t('requesting')}
      onClick={() => void request()}
    >
      {label}
    </BusyButton>
  );

  const status = current?.status;
  const announcement = current && status !== 'cancelled' && status ? t(`${status}.title`) : '';
  let body: ReactNode;
  if (current && status === 'queued') {
    body = (
      <ExportRow
        icon={<HourglassTopOutlined aria-hidden sx={{ color: 'text.secondary' }} />}
        action={slow ? undefined : <CircularProgress size={24} aria-hidden />}
      >
        <Typography variant="subtitle2" component="strong">
          {t('queued.title')}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t.rich('queued.text', { date: () => <DateText value={current.requestedAt} withTime /> })}
        </Typography>
        {slow ? (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('queued.slow')}
          </Typography>
        ) : null}
      </ExportRow>
    );
  } else if (current && status === 'ready' && current.expiresAt) {
    const expiresAt = current.expiresAt;
    body = (
      <>
        <ExportRow
          icon={<TaskOutlined aria-hidden sx={{ color: 'text.secondary' }} />}
          action={
            <BusyButton
              variant="contained"
              startIcon={<DownloadOutlined />}
              busy={downloading}
              busyLabel={t('ready.downloading')}
              onClick={() => void download()}
            >
              {t('ready.download')}
            </BusyButton>
          }
        >
          <Typography variant="subtitle2" component="strong">
            {t('ready.title')}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t.rich('ready.text', { date: () => <DateText value={expiresAt} withTime /> })}{' '}
            <Box component="span" sx={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {t('ready.fileName')}
            </Box>
          </Typography>
        </ExportRow>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('ready.linkNote')}
        </Typography>
      </>
    );
  } else if (current && status === 'failed') {
    body = (
      <InlineAlert
        severity="error"
        role="alert"
        title={t('failed.title')}
        action={requestButton(t('failed.retry'), 'outlined')}
      >
        {t('failed.text')}
      </InlineAlert>
    );
  } else if (current && status === 'expired' && current.expiresAt) {
    const expiresAt = current.expiresAt;
    body = (
      <ExportRow
        icon={<EventBusyOutlined aria-hidden sx={{ color: 'text.secondary' }} />}
        action={requestButton(t('expired.again'), 'outlined')}
      >
        <Typography variant="subtitle2" component="strong">
          {t('expired.title')}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t.rich('expired.text', { date: () => <DateText value={expiresAt} withTime /> })}
        </Typography>
      </ExportRow>
    );
  } else {
    // none yet, or the last one was cancelled (the account was closed and reopened is impossible; it
    // can only be a closure race): ask for a new one
    body = (
      <>
        <Typography variant="body2">{t('intro')}</Typography>
        <Box>{requestButton(t('request'), 'contained')}</Box>
      </>
    );
  }

  return (
    <PrivacySection title={t('title')} description={t('description')}>
      {/* the state is announced when it changes (preparing, then ready or failed), politely, from a
          region that is always there so the change is heard */}
      <Box role="status" sx={visuallyHidden}>
        {announcement}
      </Box>
      <Stack spacing={1.5}>{body}</Stack>
      {failure ? (
        <InlineAlert severity="error" role="alert">
          {failure}
        </InlineAlert>
      ) : null}
    </PrivacySection>
  );
}
