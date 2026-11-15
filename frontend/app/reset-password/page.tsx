'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Box, Stack, TextField, Button, Alert, CircularProgress, Link } from '@mui/material';
import { AuthFormPage } from '@/app/components/patterns/PublicScreens';
import { readApiError, useApiErrorMessage } from '@/lib/api-error';

export default function ResetPasswordRequestPage() {
  const router = useRouter();
  const t = useTranslations('resetPassword.request');
  const apiErrorMessage = useApiErrorMessage();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        throw await readApiError(response);
      }

      setSuccess(true);
      setEmail('');
    } catch (err: unknown) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFormPage title={t('title')} summary={success ? undefined : t('hint')}>
      {error && <Alert severity="error">{error}</Alert>}

      {success ? (
        <>
          <Alert severity="success">{t('success')}</Alert>
          <Button
            variant="contained"
            color="primary"
            size="large"
            fullWidth
            onClick={() => router.push('/login')}
          >
            {t('backToLogin')}
          </Button>
        </>
      ) : (
        <Stack component="form" spacing={2} onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label={t('email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <Button
            type="submit"
            variant="contained"
            color="primary"
            size="large"
            fullWidth
            disabled={loading}
          >
            {loading ? <CircularProgress size="1.5rem" /> : t('submit')}
          </Button>

          <Box sx={{ textAlign: 'center' }}>
            <Link
              component="button"
              type="button"
              variant="subtitle2"
              onClick={() => router.push('/login')}
            >
              {t('backToLogin')}
            </Link>
          </Box>
        </Stack>
      )}
    </AuthFormPage>
  );
}
