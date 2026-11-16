'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Stack,
  TextField,
  Button,
  Typography,
  Alert,
  Link as MuiLink,
  Divider,
} from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import { AuthFormPage } from '@/app/components/patterns/PublicScreens';
import { publicEnv } from '@/lib/env';
import { ApiError, useApiErrorMessage } from '@/lib/api-error';

const API_URL = publicEnv.apiUrl;

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const t = useTranslations('login');
  const tCommon = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // The Google callback sends a refusal back as /login?error=<CODE> (BR-001-08); show its message.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the query string is an external system, readable only after mount
    if (code) setError(apiErrorMessage(new ApiError(code)));
  }, [apiErrorMessage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      router.push('/');
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
          autoComplete="current-password"
        />

        <Button fullWidth size="large" variant="contained" type="submit" disabled={loading}>
          {loading ? t('submitting') : tCommon('signIn')}
        </Button>
      </Stack>

      <Divider>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('or')}
        </Typography>
      </Divider>

      <Button
        fullWidth
        size="large"
        variant="outlined"
        startIcon={<GoogleIcon />}
        onClick={() => {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the Google sign-in starts on the API (a redirect to the provider), not on a Next page, so it needs a full-page navigation
          window.location.assign(`${API_URL}/api/auth/google`);
        }}
      >
        {t('google')}
      </Button>

      <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
        {t.rich('noAccount', {
          link: (chunks) => (
            <MuiLink component={Link} href="/register" variant="subtitle2">
              {chunks}
            </MuiLink>
          ),
        })}
      </Typography>
    </AuthFormPage>
  );
}
