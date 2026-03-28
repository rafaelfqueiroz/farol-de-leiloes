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
  Link as MuiLink,
  Divider,
  ThemeProvider,
} from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import GavelIcon from '@mui/icons-material/Gavel';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import theme, { colors } from '../theme';

const API_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
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
    } catch (err: any) {
      setError(err.message || 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(135deg, ${colors.maroon} 0%, ${colors.red} 100%)`,
          padding: 2,
        }}
      >
        <Card sx={{ maxWidth: 450, width: '100%' }}>
          <CardContent sx={{ p: 4 }}>
            <Box sx={{ textAlign: 'center', mb: 3 }}>
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  backgroundColor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mx: 'auto',
                  mb: 2,
                }}
              >
                <GavelIcon sx={{ color: 'white', fontSize: 28 }} />
              </Box>
              <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>
                Farol dos Leilões
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Entre para acessar sua conta
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
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                sx={{ mb: 2 }}
                autoComplete="email"
              />

              <TextField
                fullWidth
                label="Senha"
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
                {loading ? 'Entrando...' : 'Entrar'}
              </Button>
            </form>

            <Divider sx={{ my: 3 }}>
              <Typography variant="body2" color="text.secondary">
                ou
              </Typography>
            </Divider>

            <Button
              fullWidth
              variant="outlined"
              startIcon={<GoogleIcon />}
              onClick={() => {
                window.location.href = `${API_URL}/api/auth/google`;
              }}
              sx={{
                mb: 3,
                py: 1.5,
                //borderColor: colors.red,
                //color: colors.red,
              }}
            >
              Entrar com Google
            </Button>

            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                Não tem uma conta?{' '}
                <MuiLink component={Link} href="/register" sx={{ cursor: 'pointer', color: 'primary.main', fontWeight: 500 }}>
                  Cadastre-se
                </MuiLink>
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </ThemeProvider>
  );
}
