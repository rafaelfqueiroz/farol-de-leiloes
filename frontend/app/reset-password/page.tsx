'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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

export default function ResetPasswordRequestPage() {
  const router = useRouter();
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
        const data = await response.json();
        throw new Error(data.message || 'Failed to request password reset');
      }

      setSuccess(true);
      setEmail('');
    } catch (err: any) {
      setError(err.message || 'Erro ao solicitar redefinição de senha');
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
            Redefinir Senha
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                Um email foi enviado com instruções para redefinir sua senha. Verifique sua caixa de entrada.
              </Alert>
              <Button
                variant="contained"
                color="primary"
                fullWidth
                onClick={() => router.push('/login')}
                sx={{ mt: 2 }}
              >
                Voltar para Login
              </Button>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Digite seu email para receber instruções de redefinição de senha.
              </Typography>

              <TextField
                fullWidth
                label="Email"
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
                {loading ? <CircularProgress size={24} /> : 'Enviar Email'}
              </Button>

              <Box sx={{ textAlign: 'center', mt: 2 }}>
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  onClick={() => router.push('/login')}
                  sx={{ cursor: 'pointer' }}
                >
                  Voltar para Login
                </Link>
              </Box>
            </form>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
