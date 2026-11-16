'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Stack, TextField, Button, Typography, Alert, Link as MuiLink } from '@mui/material';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import { AuthFormPage } from '@/app/components/patterns/PublicScreens';
import { useApiErrorMessage } from '@/lib/api-error';

// The shortest password the form accepts
const MIN_PASSWORD_LENGTH = 8; // SPEC-001 BR-001-13

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const t = useTranslations('register');
  const apiErrorMessage = useApiErrorMessage();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

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
      await register(email, password, name);
      router.push('/verify-email');
    } catch (err: unknown) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFormPage title={t('title')} summary={t('subtitle')}>
      {error && <Alert severity="error">{error}</Alert>}

      <Stack component="form" spacing={2} onSubmit={handleSubmit}>
        <TextField
          fullWidth
          label={t('name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
        />

        <TextField
          fullWidth
          label={t('email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        <TextField
          fullWidth
          label={t('password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          helperText={t('passwordHelper', { min: MIN_PASSWORD_LENGTH })}
        />

        <TextField
          fullWidth
          label={t('confirmPassword')}
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
        />

        <Button fullWidth size="large" variant="contained" type="submit" disabled={loading}>
          {loading ? t('submitting') : t('submit')}
        </Button>

        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
          {t.rich('hasAccount', {
            link: (chunks) => (
              <MuiLink component={Link} href="/login" variant="subtitle2">
                {chunks}
              </MuiLink>
            ),
          })}
        </Typography>
      </Stack>
    </AuthFormPage>
  );
}
