'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import { visuallyHidden } from '@mui/utils';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import PageHeader from '@/app/components/patterns/PageHeader';
import PageShell from '@/app/components/patterns/PageShell';
import { useAuth } from '@/app/contexts/AuthContext';
import { apiFetch, apiJson } from '@/lib/api-client';
import { readApiError } from '@/lib/api-error';
import { currentLegalSchema, type CurrentLegal } from '@/lib/legal';
import { reportClientError } from '@/lib/report-client-error';
import AcceptancesSection from './AcceptancesSection';
import DeleteAccountSection from './DeleteAccountSection';
import ExportSection from './ExportSection';
import MyDataSection from './MyDataSection';
import {
  PRIVACY_API,
  acceptancesSchema,
  exportsPageSchema,
  settleExpiry,
  myDataSchema,
  summarizeMyData,
  whatsappConsentSchema,
  type Acceptance,
  type DataExport,
  type MyDataSummary,
  type WhatsappConsent,
} from './privacy-api';
import WhatsappSection from './WhatsappSection';

interface Snapshot {
  acceptances: Acceptance[];
  whatsapp: WhatsappConsent;
  myData: MyDataSummary;
  latestExport: DataExport | null;
  /** The versions in force, to mark a draft; the page does not depend on it. */
  legal: CurrentLegal | null;
}

type Load = { name: 'loading' } | { name: 'failed' } | { name: 'ready'; snapshot: Snapshot };

/** The newest export, settled against the server's own clock (see `settleExpiry`). */
async function readLatestExport(): Promise<DataExport | null> {
  const response = await apiFetch(PRIVACY_API.latestExport);
  if (!response.ok) throw await readApiError(response);
  const page = exportsPageSchema.parse(await response.json());
  return settleExpiry(page.items[0] ?? null, response.headers.get('date'));
}

async function readSnapshot(): Promise<Snapshot> {
  const [acceptances, whatsapp, myData, exports, legal] = await Promise.all([
    apiJson<unknown>(PRIVACY_API.acceptances),
    apiJson<unknown>(PRIVACY_API.whatsapp),
    apiJson<unknown>(PRIVACY_API.myData),
    readLatestExport(),
    apiJson<unknown>('/api/legal/current').catch(() => null),
  ]);
  const legalDocuments = currentLegalSchema.safeParse(legal);
  return {
    acceptances: acceptancesSchema.parse(acceptances).items,
    whatsapp: whatsappConsentSchema.parse(whatsapp),
    myData: summarizeMyData(myDataSchema.parse(myData)),
    latestExport: exports,
    legal: legalDocuments.success ? legalDocuments.data : null,
  };
}

function Skeletons() {
  const t = useTranslations('privacy');
  return (
    <Stack spacing={3} role="status" aria-live="polite">
      <Box component="span" sx={visuallyHidden}>
        {t('loading')}
      </Box>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} variant="rounded" height={140} aria-hidden />
      ))}
    </Stack>
  );
}

/**
 * SPEC-010 BR-010-04, BR-010-08..13, BR-010-27 (frame "Privacidade e dados"), inside the signed-in
 * shell: what the account accepted, the WhatsApp consent, what is held, the export, and deleting the
 * account (the danger zone, last). It stays reachable under a pending version of the documents (the
 * API exempts it, DL-010-03). SC-15: it renders personal data and logs none of it.
 */
export default function PrivacyPage() {
  const t = useTranslations('privacy');
  const tCommon = useTranslations('common');
  const { isAuthenticated } = useAuth();
  const [load, setLoad] = useState<Load>({ name: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    readSnapshot().then(
      (snapshot) => {
        if (!cancelled) setLoad({ name: 'ready', snapshot });
      },
      (error: unknown) => {
        if (cancelled) return;
        reportClientError(error, { where: 'privacy page' });
        setLoad({ name: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, attempt]);

  const retry = useCallback(() => {
    setLoad({ name: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  const snapshot = load.name === 'ready' ? load.snapshot : null;
  const setWhatsapp = (whatsapp: WhatsappConsent) =>
    setLoad((current) =>
      current.name === 'ready'
        ? { name: 'ready', snapshot: { ...current.snapshot, whatsapp } }
        : current,
    );

  return (
    <PageShell width="reading">
      <PageHeader title={t('title')} summary={t('summary')} />
      {load.name === 'loading' ? <Skeletons /> : null}
      {load.name === 'failed' ? (
        <InlineAlert
          severity="error"
          role="alert"
          title={t('loadFailed.title')}
          action={
            <Button variant="outlined" onClick={retry}>
              {tCommon('tryAgain')}
            </Button>
          }
        >
          {t('loadFailed.text')}
        </InlineAlert>
      ) : null}
      {snapshot ? (
        <Stack spacing={3}>
          <AcceptancesSection acceptances={snapshot.acceptances} current={snapshot.legal} />
          <WhatsappSection consent={snapshot.whatsapp} onChange={setWhatsapp} />
          <MyDataSection data={snapshot.myData} />
          <ExportSection initial={snapshot.latestExport} />
          <DeleteAccountSection />
        </Stack>
      ) : null}
    </PageShell>
  );
}
