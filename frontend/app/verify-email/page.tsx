'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Box, Card, CardContent, Typography, Button, Alert, CircularProgress } from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
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
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated || emailVerified) {
    return null;
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 2,
      }}
    >
      <Card sx={{ maxWidth: 450, width: '100%' }}>
        <CardContent sx={{ p: 4, textAlign: 'center' }}>
          <EmailIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />

          <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
            {t('title')}
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t.rich('description', {
              email: user?.email ?? '',
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </Typography>

          {sent && (
            <Alert severity="success" sx={{ mb: 3 }}>
              {t('sent')}
            </Alert>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          <Button
            fullWidth
            variant="contained"
            onClick={handleResend}
            disabled={sending}
            sx={{ mb: 2, py: 1.5 }}
          >
            {sending ? t('sending') : t('resend')}
          </Button>

          <Button fullWidth variant="outlined" onClick={handleLogout} sx={{ py: 1.5 }}>
            {tCommon('signOut')}
          </Button>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: 'block' }}>
            {t('expiry')}
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
