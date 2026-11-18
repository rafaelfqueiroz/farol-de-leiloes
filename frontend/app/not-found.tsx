'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import EmailVerificationBanner from '@/app/components/account/EmailVerificationBanner';
import BillingBanner from '@/app/components/plans/BillingBanner';
import AppShell from '@/app/components/patterns/AppShell';
import EmptyState from '@/app/components/patterns/EmptyState';
import PageShell from '@/app/components/patterns/PageShell';

export default function NotFound() {
  const router = useRouter();
  const t = useTranslations('notFound.page');

  return (
    // #42: the root not-found cannot sit in a route group, so it mounts the AppShell itself
    // (guest or signed in). DS-15: a full-page state has no PageHeader, so its title is the h1
    <AppShell
      banner={
        <BillingBanner>
          <EmailVerificationBanner />
        </BillingBanner>
      }
    >
      <PageShell width="reading">
        <EmptyState
          icon={ErrorOutlineOutlined}
          title={t('title')}
          description={t('description')}
          titleComponent="h1"
          actions={
            <Button
              variant="contained"
              size="large"
              startIcon={<SearchIcon />}
              onClick={() => router.push('/search')}
            >
              {t('action')}
            </Button>
          }
        />
      </PageShell>
    </AppShell>
  );
}
