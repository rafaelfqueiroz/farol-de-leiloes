'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Box, Card, CardContent, Typography, Alert, CircularProgress, Button } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import Link from 'next/link';
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
          {status === 'loading' && (
            <>
              <CircularProgress size={64} sx={{ mb: 3 }} />
              <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
                {t('loadingTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('loadingHint')}
              </Typography>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
              <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
                {t('successTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {t('successHint')}
              </Typography>
              <Button component={Link} href="/login" variant="contained" fullWidth>
                {t('goToLogin')}
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <ErrorIcon sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
              <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
                {t('errorTitle')}
              </Typography>
              <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
                {error}
              </Alert>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {t('errorHint')}
              </Typography>
              <Button component={Link} href="/login" variant="contained" fullWidth>
                {t('goToLogin')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
