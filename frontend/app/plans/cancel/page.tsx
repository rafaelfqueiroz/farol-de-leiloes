'use client';

import { useRouter } from 'next/navigation';
import { Box, Container, Typography, Button, ThemeProvider } from '@mui/material';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import theme from '../../theme';

export default function PlansCancelPage() {
  const router = useRouter();

  return (
    <ThemeProvider theme={theme}>
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FAFAF9',
        }}
      >
        <Container maxWidth="sm" sx={{ textAlign: 'center' }}>
          <CancelOutlinedIcon sx={{ fontSize: 80, color: '#f44336', mb: 2 }} />
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>
            Pagamento cancelado
          </Typography>
          <Typography variant="body1" sx={{ mb: 4, color: '#6B7280' }}>
            O pagamento foi cancelado. Voce pode tentar novamente quando quiser.
          </Typography>
          <Button variant="contained" onClick={() => router.push('/plans')}>
            Voltar aos planos
          </Button>
        </Container>
      </Box>
    </ThemeProvider>
  );
}
