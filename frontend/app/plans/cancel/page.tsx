'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { ResultScreen } from '@/app/components/patterns/PublicScreens';

export default function PlansCancelPage() {
  const router = useRouter();
  const t = useTranslations('plansResult.cancel');

  return (
    <ResultScreen
      tone="info"
      icon={InfoOutlinedIcon}
      title={t('title')}
      description={t('description')}
    >
      <Button variant="contained" onClick={() => router.push('/plans')}>
        {t('back')}
      </Button>
    </ResultScreen>
  );
}
