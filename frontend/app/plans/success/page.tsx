'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Container, Typography, Button } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useAuth } from '../../contexts/AuthContext';

export default function PlansSuccessPage() {
  const router = useRouter();
  const { refreshUser } = useAuth();

  useEffect(() => {
    void refreshUser();
    const timer = setTimeout(() => {
      router.push('/search');
    }, 5000);
    return () => clearTimeout(timer);
  }, [refreshUser, router]);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Container maxWidth="sm" sx={{ textAlign: 'center' }}>
        <CheckCircleOutlineIcon sx={{ fontSize: 80, color: 'success.main', mb: 2 }} />
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>
          Assinatura realizada com sucesso!
        </Typography>
        <Typography variant="body1" sx={{ mb: 4, color: 'text.secondary' }}>
          Voce agora tem acesso a todos os recursos do plano Standard, incluindo a busca por IA.
          Voce sera redirecionado automaticamente.
        </Typography>
        <Button variant="contained" onClick={() => router.push('/search')}>
          Ir para a busca
        </Button>
      </Container>
    </Box>
  );
}
