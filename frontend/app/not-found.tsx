'use client';

import { useRouter } from 'next/navigation';
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Button,
  ThemeProvider,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import { useSidebar } from './contexts/SidebarContext';
import theme from './theme';

export default function NotFound() {
  const router = useRouter();
  const { sidebarWidth } = useSidebar();

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: '#FAFAF9' }}>
        <Sidebar activeView="search" onViewChange={() => router.push('/')} />

        <Box sx={{ flexGrow: 1, ml: `${sidebarWidth}px`, transition: 'margin-left 0.3s ease' }}>
          <TopBar />

          <Box component="main" sx={{ pt: 10, pb: 4 }}>
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
        </Box>
      </Box>
    </ThemeProvider>
  );
}
