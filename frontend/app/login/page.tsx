'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Box,
  Card,
  CardContent,
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
import Logo from '@/app/components/patterns/Logo';
import { publicEnv } from '@/lib/env';
import { useApiErrorMessage } from '@/lib/api-error';

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
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        padding: 2,
      }}
    >
      <Card sx={{ maxWidth: 450, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            {/* the card is background.paper, so the mark's primary tower reads on it */}
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <Logo variant="lockup" size={40} />
            </Box>
            <Typography component="h1" variant="body1" color="text.secondary">
              {t('subtitle')}
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label={t('email')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              sx={{ mb: 2 }}
              autoComplete="email"
            />

            <TextField
              fullWidth
              label={t('password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              sx={{ mb: 3 }}
              autoComplete="current-password"
            />

            <Button
              fullWidth
              variant="contained"
              type="submit"
              disabled={loading}
              sx={{ mb: 2, py: 1.5 }}
            >
              {loading ? t('submitting') : tCommon('signIn')}
            </Button>
          </form>

          <Divider sx={{ my: 3 }}>
            <Typography variant="body2" color="text.secondary">
              {t('or')}
            </Typography>
          </Divider>

          <Button
            fullWidth
            variant="outlined"
            startIcon={<GoogleIcon />}
            onClick={() => {
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the Google sign-in starts on the API (a redirect to the provider), not on a Next page, so it needs a full-page navigation
              window.location.assign(`${API_URL}/api/auth/google`);
            }}
            sx={{
              mb: 3,
              py: 1.5,
            }}
          >
            {t('google')}
          </Button>

          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {t.rich('noAccount', {
                link: (chunks) => (
                  <MuiLink
                    component={Link}
                    href="/register"
                    sx={{ cursor: 'pointer', color: 'primary.main', fontWeight: 500 }}
                  >
                    {chunks}
                  </MuiLink>
                ),
              })}
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
