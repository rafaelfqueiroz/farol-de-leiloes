'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Stack, TextField, Button, Alert, CircularProgress } from '@mui/material';
import { AuthFormPage } from '@/app/components/patterns/PublicScreens';
import { readApiError, useApiErrorMessage } from '@/lib/api-error';

// The shortest password the form accepts
const MIN_PASSWORD_LENGTH = 6;

export default function ResetPasswordPage() {
  const router = useRouter();
  const t = useTranslations('resetPassword.confirm');
  const apiErrorMessage = useApiErrorMessage();
  const params = useParams();
  const token = params.token as string;
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (password !== confirmPassword) {
      setError(t('errors.passwordMismatch'));
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('errors.passwordTooShort', { min: MIN_PASSWORD_LENGTH }));
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token, newPassword: password }), // AR-34: the DTO's field name
      });

      if (!response.ok) {
        throw await readApiError(response);
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/login');
      }, 2000);
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
        <Alert severity="success">{t('success')}</Alert>
      ) : (
        <Stack component="form" spacing={2} onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label={t('password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <TextField
            fullWidth
            label={t('confirmPassword')}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
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
        </Stack>
      )}
    </AuthFormPage>
  );
}
