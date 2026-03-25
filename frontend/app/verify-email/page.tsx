'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  CircularProgress,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import { useAuth } from '../contexts/AuthContext';

export default function VerifyEmailPage() {
  const router = useRouter();
  const { user, loading, isAuthenticated, emailVerified, resendVerificationEmail, logout } = useAuth();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading) {
      if (!isAuthenticated) {
        router.push('/login');
      } else if (emailVerified) {
        router.push('/');
      }
    }
  }, [loading, isAuthenticated, emailVerified, router]);

  const handleResend = async () => {
    setSending(true);
    setError('');
    setSent(false);

    try {
      await resendVerificationEmail();
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar email de verificacao');
    } finally {
      setSending(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FFFFFF',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated || emailVerified) {
    return null;
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFFFFF',
        padding: 2,
      }}
    >
      <Card sx={{ maxWidth: 450, width: '100%' }}>
        <CardContent sx={{ p: 4, textAlign: 'center' }}>
          <EmailIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />

          <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
            Verifique seu email
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Enviamos um email de verificacao para{' '}
            <strong>{user?.email}</strong>. Por favor, verifique sua caixa de
            entrada e clique no link para ativar sua conta.
          </Typography>

          {sent && (
            <Alert severity="success" sx={{ mb: 3 }}>
              Email de verificacao enviado com sucesso! Verifique sua caixa de
              entrada.
            </Alert>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          <Button
            fullWidth
            variant="contained"
            onClick={handleResend}
            disabled={sending}
            sx={{ mb: 2, py: 1.5 }}
          >
            {sending ? 'Enviando...' : 'Reenviar email de verificacao'}
          </Button>

          <Button
            fullWidth
            variant="outlined"
            onClick={handleLogout}
            sx={{ py: 1.5 }}
          >
            Sair
          </Button>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: 'block' }}>
            O link de verificacao expira em 24 horas. Se nao encontrar o email,
            verifique sua pasta de spam.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
