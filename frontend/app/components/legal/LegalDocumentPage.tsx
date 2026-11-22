'use client';

import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import { visuallyHidden } from '@mui/utils';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import LegalDocument from '@/app/components/patterns/LegalDocument';
import PageHeader from '@/app/components/patterns/PageHeader';
import PageShell from '@/app/components/patterns/PageShell';
import { LEGAL_PATHS, type LegalDocumentData, type LegalDocumentType } from '@/lib/legal';

export interface LegalDocumentPageProps {
  kind: LegalDocumentType;
  /** The version in force, or null when the API could not answer (the error state, DS-19). */
  document: LegalDocumentData | null;
}

// SPEC-010 BR-010-02, BR-010-04 (frame "Documentos legais"): /termos and /privacidade show ONLY the
// version in force; an older version is kept for the proof of acceptance and has no page. Public,
// inside the shell with the guest top bar for a visitor.
export default function LegalDocumentPage({ kind, document }: LegalDocumentPageProps) {
  const t = useTranslations('legal');
  return (
    <PageShell width="reading">
      {document ? (
        <LegalDocument
          kind={kind}
          title={document.title}
          version={document.version}
          effectiveAt={document.effectiveAt}
          draft={document.draft}
          content={document.content}
        />
      ) : (
        <>
          <PageHeader title={t(`titles.${kind}`)} />
          <InlineAlert
            severity="error"
            role="alert"
            title={t('loadFailed.title')}
            action={
              // a full reload of the same address: the server reads the document again
              <Button variant="outlined" component="a" href={LEGAL_PATHS[kind]}>
                {t('loadFailed.retry')}
              </Button>
            }
          >
            {t('loadFailed.text')}
          </InlineAlert>
        </>
      )}
    </PageShell>
  );
}

/** The loading state of a legal page (DS-19): a skeleton shaped like a title and a text. */
export function LegalDocumentSkeleton() {
  const t = useTranslations('legal');
  return (
    <PageShell width="reading">
      <Skeleton variant="rounded" height={36} width="60%" />
      <Stack role="status" aria-live="polite" spacing={1.5}>
        <Box component="span" sx={visuallyHidden}>
          {t('loading')}
        </Box>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} variant="rounded" height={20} />
        ))}
      </Stack>
    </PageShell>
  );
}
