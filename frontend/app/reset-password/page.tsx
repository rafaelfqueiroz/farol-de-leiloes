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
  CircularProgress,
  Link,
} from '@mui/material';
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
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" component="h1" gutterBottom sx={{ mb: 3, fontWeight: 600 }}>
            {t('title')}
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                {t('success')}
              </Alert>
              <Button
                variant="contained"
                color="primary"
                fullWidth
                onClick={() => router.push('/login')}
                sx={{ mt: 2 }}
              >
                {t('backToLogin')}
              </Button>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {t('hint')}
              </Typography>

              <TextField
                fullWidth
                label={t('email')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                margin="normal"
                required
                autoFocus
              />

              <Button
                type="submit"
                variant="contained"
                color="primary"
                fullWidth
                disabled={loading}
                sx={{ mt: 3, mb: 2 }}
              >
                {loading ? <CircularProgress size={24} /> : t('submit')}
              </Button>

              <Box sx={{ textAlign: 'center', mt: 2 }}>
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  onClick={() => router.push('/login')}
                  sx={{ cursor: 'pointer' }}
                >
                  {t('backToLogin')}
                </Link>
              </Box>
            </form>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
