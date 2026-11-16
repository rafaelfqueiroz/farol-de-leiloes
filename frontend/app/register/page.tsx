'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Stack,
  TextField,
  Button,
  Typography,
  Alert,
  Divider,
  Link as MuiLink,
} from '@mui/material';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import { AuthFormPage } from '@/app/components/patterns/PublicScreens';
import GoogleSignInButton from '@/app/components/account/GoogleSignInButton';
import TermsAcceptance from '@/app/components/account/TermsAcceptance';
import { ApiError, useApiErrorMessage } from '@/lib/api-error';

// The password length the form accepts
const MIN_PASSWORD_LENGTH = 8; // SPEC-001 BR-001-13
const MAX_PASSWORD_LENGTH = 128; // SPEC-001 BR-001-13

type FieldErrors = Partial<Record<'email' | 'password' | 'confirmPassword', string>>;

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const t = useTranslations('register');
  const tLogin = useTranslations('login');
  const apiErrorMessage = useApiErrorMessage();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [termsMissing, setTermsMissing] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const invalid: FieldErrors = {};

    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      invalid.password = t('errors.passwordLength', {
        min: MIN_PASSWORD_LENGTH,
        max: MAX_PASSWORD_LENGTH,
      });
    }
    if (password !== confirmPassword) {
      invalid.confirmPassword = t('errors.passwordMismatch');
    }
    // BR-001-02: the acceptance blocks the submit on the client; the API refuses it as well
    setTermsMissing(!accepted);
    setFieldErrors(invalid);
    if (!accepted || Object.keys(invalid).length > 0) return;

    setLoading(true);

    try {
      await register(email, password, name);
      router.push('/verify-email');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'EMAIL_ALREADY_REGISTERED') {
        // frame 1.2: the error sits under the E-mail field
        setFieldErrors({ email: apiErrorMessage(err) });
      } else {
        setError(apiErrorMessage(err));
      }
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
          error={Boolean(fieldErrors.email)}
          helperText={fieldErrors.email}
        />

        <TextField
          fullWidth
          label={t('password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          slotProps={{ htmlInput: { maxLength: MAX_PASSWORD_LENGTH } }}
          // the hint gives way to the error when the length is wrong
          error={Boolean(fieldErrors.password)}
          helperText={
            fieldErrors.password ??
            t('passwordHelper', { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH })
          }
        />

        <TextField
          fullWidth
          label={t('confirmPassword')}
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
          error={Boolean(fieldErrors.confirmPassword)}
          helperText={fieldErrors.confirmPassword}
        />

        <TermsAcceptance
          checked={accepted}
          onChange={(checked) => {
            setAccepted(checked);
            if (checked) setTermsMissing(false);
          }}
          error={termsMissing}
        />

        <Button fullWidth size="large" variant="contained" type="submit" disabled={loading}>
          {loading ? t('submitting') : t('submit')}
        </Button>
      </Stack>

      <Divider>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {tLogin('or')}
        </Typography>
      </Divider>

      <GoogleSignInButton />

      <Typography variant="body2" sx={{ textAlign: 'center' }}>
        <MuiLink component={Link} href="/login" variant="subtitle2">
          {t('hasAccount')}
        </MuiLink>
      </Typography>
    </AuthFormPage>
  );
}
