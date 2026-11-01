'use client';

import { useRouter } from 'next/navigation';
import { Box, Container, Typography, Card, CardContent, Button } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import AppShell from '@/app/components/patterns/AppShell';

export default function NotFound() {
  const router = useRouter();

  return (
    // #42: the root not-found cannot sit in a route group, so it mounts the AppShell itself
    // (guest or signed in); pt no longer offsets a fixed bar
    <AppShell>
      <Box sx={{ pt: 2, pb: 4 }}>
        <Container maxWidth="xl">
          <Card>
            <CardContent
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                py: 10,
              }}
            >
              <ErrorOutlineIcon sx={{ fontSize: 80, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h4" fontWeight={600} gutterBottom>
                Página não encontrada
              </Typography>
              <Typography
                variant="body1"
                color="text.secondary"
                sx={{ maxWidth: 420, textAlign: 'center', mb: 4 }}
              >
                O conteúdo que você procura não existe ou não está mais disponível.
              </Typography>
              <Button
                variant="contained"
                size="large"
                startIcon={<SearchIcon />}
                onClick={() => router.push('/search')}
              >
                Buscar imóveis
              </Button>
            </CardContent>
          </Card>
        </Container>
      </Box>
    </AppShell>
  );
}
