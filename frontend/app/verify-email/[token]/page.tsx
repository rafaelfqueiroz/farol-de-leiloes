'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Alert,
  CircularProgress,
  Button,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import Link from 'next/link';

export default function VerifyEmailTokenPage() {
  const router = useRouter();
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
          const data = await response.json();
          throw new Error(data.message || 'Falha na verificacao');
        }

        setStatus('success');
        setTimeout(() => router.push('/login'), 3000);
      } catch (err: any) {
        setStatus('error');
        setError(err.message || 'Erro ao verificar email');
      }
    };

    if (token) {
      verifyEmail();
    }
  }, [token, router]);

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
                Verificando email...
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Aguarde enquanto verificamos seu email.
              </Typography>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircleIcon
                sx={{ fontSize: 64, color: 'success.main', mb: 2 }}
              />
              <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
                Email verificado!
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Seu email foi verificado com sucesso. Voce sera redirecionado
                para a pagina de login.
              </Typography>
              <Button
                component={Link}
                href="/login"
                variant="contained"
                fullWidth
              >
                Ir para Login
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <ErrorIcon sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
              <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
                Erro na verificacao
              </Typography>
              <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
                {error}
              </Alert>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                O link de verificacao pode estar expirado ou ser invalido. Faca
                login para solicitar um novo email de verificacao.
              </Typography>
              <Button
                component={Link}
                href="/login"
                variant="contained"
                fullWidth
              >
                Ir para Login
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
