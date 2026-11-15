'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Typography, Button, Alert } from '@mui/material';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import { LoadingScreen, ResultScreen } from '@/app/components/patterns/PublicScreens';
import { useAuth } from '../contexts/AuthContext';
import { useApiErrorMessage } from '@/lib/api-error';

export default function VerifyEmailPage() {
  const router = useRouter();
  const { user, loading, isAuthenticated, emailVerified, resendVerificationEmail, logout } =
    useAuth();
  const [sending, setSending] = useState(false);
  const t = useTranslations('verifyEmail.pending');
  const tCommon = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading) {
      if (!isAuthenticated) {
        router.push('/login');
      } else if (emailVerified) {
        router.push('/');
      }
    }
  }, [loading, isAuthenticated, emailVerified, router]);

  const handleResend = async () => {
    setSending(true);
    setError('');
    setSent(false);

    try {
      await resendVerificationEmail();
      setSent(true);
    } catch (err: unknown) {
      setError(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  if (loading) {
    return <LoadingScreen title={tCommon('loading')} />;
  }

  if (!isAuthenticated || emailVerified) {
    return null;
  }

  return (
    <ResultScreen
      tone="info"
      icon={MailOutlineIcon}
      title={t('title')}
      description={t.rich('description', {
        email: user?.email ?? '',
        strong: (chunks) => <strong>{chunks}</strong>,
      })}
    >
      {sent && <Alert severity="success">{t('sent')}</Alert>}

      {error && <Alert severity="error">{error}</Alert>}

      <Button fullWidth size="large" variant="contained" onClick={handleResend} disabled={sending}>
        {sending ? t('sending') : t('resend')}
      </Button>

      <Button fullWidth size="large" variant="outlined" onClick={handleLogout}>
        {tCommon('signOut')}
      </Button>

      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('expiry')}
      </Typography>
    </ResultScreen>
  );
}
