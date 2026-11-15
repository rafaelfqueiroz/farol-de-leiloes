'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { ResultScreen } from '@/app/components/patterns/PublicScreens';
import { useAuth } from '../../contexts/AuthContext';

export default function PlansSuccessPage() {
  const router = useRouter();
  const t = useTranslations('plansResult.success');
  const { refreshUser } = useAuth();

  useEffect(() => {
    void refreshUser();
    const timer = setTimeout(() => {
      router.push('/search');
    }, 5000);
    return () => clearTimeout(timer);
  }, [refreshUser, router]);

  return (
    <ResultScreen
      tone="success"
      icon={CheckCircleOutlineIcon}
      title={t('title')}
      description={t('description')}
    >
      <Button variant="contained" onClick={() => router.push('/search')}>
        {t('goToSearch')}
      </Button>
    </ResultScreen>
  );
}
