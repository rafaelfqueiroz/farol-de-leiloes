'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import HomeWorkOutlined from '@mui/icons-material/HomeWorkOutlined';
import EmptyState from '@/app/components/patterns/EmptyState';
import PageShell from '@/app/components/patterns/PageShell';

export default function AuctionNotFound() {
  const router = useRouter();
  const t = useTranslations('notFound.auction');

  return (
    // #42: rendered inside the (shell) layout, so the AppShell (guest or signed in) frames it.
    // DS-15: a full-page state has no PageHeader, so its title is the page's h1
    <PageShell width="reading">
      <EmptyState
        icon={HomeWorkOutlined}
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
  );
}
