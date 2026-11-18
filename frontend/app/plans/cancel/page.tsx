'use client';

import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import Button from '@mui/material/Button';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ResultScreen } from '@/app/components/patterns/PublicScreens';

// SPEC-012 (frame r6): back from the hosted checkout without paying. Nothing was created: an
// abandoned checkout leaves no office and no subscription.
export default function PlansCancelPage() {
  const t = useTranslations('plansResult.cancel');

  return (
    <ResultScreen
      tone="info"
      icon={InfoOutlinedIcon}
      title={t('title')}
      description={t('description')}
    >
      <Button component={Link} href="/plans" variant="contained" fullWidth>
        {t('back')}
      </Button>
    </ResultScreen>
  );
}
