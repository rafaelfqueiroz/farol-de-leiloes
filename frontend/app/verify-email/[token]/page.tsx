'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import Link from 'next/link';
import { ResultScreen } from '@/app/components/patterns/PublicScreens';
import { readApiError, useApiErrorMessage } from '@/lib/api-error';

export default function VerifyEmailTokenPage() {
  const router = useRouter();
  const t = useTranslations('verifyEmail.token');
  const apiErrorMessage = useApiErrorMessage();
  const params = useParams();
  const token = params.token as string;
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const verifyEmail = async () => {
      try {
        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (!response.ok) {
          throw await readApiError(response);
        }

        setStatus('success');
        setTimeout(() => router.push('/login'), 3000);
      } catch (err: unknown) {
        setStatus('error');
        setError(apiErrorMessage(err));
      }
    };

    if (token) {
      void verifyEmail();
    }
  }, [token, router, apiErrorMessage]);

  if (status === 'loading') {
    return <ResultScreen loading title={t('loadingTitle')} description={t('loadingHint')} />;
  }

  if (status === 'success') {
    return (
      <ResultScreen
        tone="success"
        icon={CheckCircleOutlineIcon}
        title={t('successTitle')}
        description={t('successHint')}
      >
        <Button component={Link} href="/login" variant="contained" size="large" fullWidth>
          {t('goToLogin')}
        </Button>
      </ResultScreen>
    );
  }

  return (
    <ResultScreen
      tone="error"
      icon={ErrorOutlineIcon}
      title={t('errorTitle')}
      description={t('errorHint')}
    >
      <Alert severity="error" sx={{ textAlign: 'left' }}>
        {error}
      </Alert>
      <Button component={Link} href="/login" variant="contained" size="large" fullWidth>
        {t('goToLogin')}
      </Button>
    </ResultScreen>
  );
}
