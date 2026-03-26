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
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import TopBar from '../../components/TopBar';
import theme, { colors } from '../../theme';

export default function AuctionNotFound() {
  const router = useRouter();

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ minHeight: '100vh', backgroundColor: colors.lightGray }}>
        <Box sx={{ flexGrow: 1 }}>
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
                  <HomeWorkIcon sx={{ fontSize: 80, color: 'text.disabled', mb: 2 }} />
                  <Typography variant="h4" fontWeight={600} gutterBottom>
                    Imóvel indisponível
                  </Typography>
                  <Typography
                    variant="body1"
                    color="text.secondary"
                    sx={{ maxWidth: 420, textAlign: 'center', mb: 4 }}
                  >
                    Este imóvel não foi encontrado ou não está mais disponível para leilão.
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
