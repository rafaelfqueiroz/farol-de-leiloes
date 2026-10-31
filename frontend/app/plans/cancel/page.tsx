'use client';

import { useRouter } from 'next/navigation';
import { Box, Container, Typography, Button } from '@mui/material';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';

export default function PlansCancelPage() {
  const router = useRouter();

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
        <CancelOutlinedIcon sx={{ fontSize: 80, color: 'error.main', mb: 2 }} />
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>
          Pagamento cancelado
        </Typography>
        <Typography variant="body1" sx={{ mb: 4, color: 'text.secondary' }}>
          O pagamento foi cancelado. Voce pode tentar novamente quando quiser.
        </Typography>
        <Button variant="contained" onClick={() => router.push('/plans')}>
          Voltar aos planos
        </Button>
      </Container>
    </Box>
  );
}
