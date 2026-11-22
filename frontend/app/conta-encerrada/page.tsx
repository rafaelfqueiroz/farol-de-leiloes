'use client';

import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import Button from '@mui/material/Button';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { ResultScreen } from '@/app/components/patterns/PublicScreens';
import { useAuth } from '@/app/contexts/AuthContext';

// SPEC-010 BR-010-14 (frame "Conta encerrada"): where the browser lands after the account was
// closed. Public and outside the shell, like the other result screens. The session cookie was
// cleared with the answer that closed the account; the page asks who is signed in once, so the app
// forgets the account it still remembers in memory (a visitor who opens this address with a live
// session simply stays signed in).
export default function AccountClosedPage() {
  const t = useTranslations('accountClosed');
  const { refreshUser } = useAuth();

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  return (
    <ResultScreen
      tone="success"
      icon={CheckCircleOutlined}
      title={t('title')}
      description={t('text')}
    >
      <Button component={Link} href="/" variant="contained" size="large" fullWidth>
        {t('action')}
      </Button>
    </ResultScreen>
  );
}
