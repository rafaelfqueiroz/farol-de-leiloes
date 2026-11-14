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
} from '@mui/material';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import Logo from '@/app/components/patterns/Logo';
import { useApiErrorMessage } from '@/lib/api-error';

// The shortest password the form accepts
const MIN_PASSWORD_LENGTH = 6;

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
              label={t('name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              sx={{ mb: 2 }}
              autoComplete="name"
            />

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
              sx={{ mb: 2 }}
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
              sx={{ mb: 3 }}
              autoComplete="new-password"
            />

            <Button
              fullWidth
              variant="contained"
              type="submit"
              disabled={loading}
              sx={{ mb: 2, py: 1.5 }}
            >
              {loading ? t('submitting') : t('submit')}
            </Button>

            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {t.rich('hasAccount', {
                  link: (chunks) => (
                    <MuiLink
                      component={Link}
                      href="/login"
                      sx={{ cursor: 'pointer', color: 'primary.main', fontWeight: 500 }}
                    >
                      {chunks}
                    </MuiLink>
                  ),
                })}
              </Typography>
            </Box>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
