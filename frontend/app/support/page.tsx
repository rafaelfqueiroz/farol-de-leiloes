'use client';

import { Suspense } from 'react';
import { Box, Container, ThemeProvider, CircularProgress } from '@mui/material';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import RequireRole from '../components/RequireRole';
import { useSidebar } from '../contexts/SidebarContext';
import SupportPage from '../components/SupportPage';
import theme from '../legacyTheme';

function SupportPageLoading() {
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

export default function Support() {
  const { sidebarWidth } = useSidebar();

  return (
    <ThemeProvider theme={theme}>
      <RequireRole minimumRole="free" featureName="Suporte">
        <Suspense fallback={<SupportPageLoading />}>
          <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: '#FFFFFF' }}>
            <Sidebar activeView="support" />

            <Box sx={{ flexGrow: 1, ml: `${sidebarWidth}px`, transition: 'margin-left 0.3s ease' }}>
              <TopBar />

              <Box component="main" sx={{ pt: 10, pb: 4 }}>
                <Container maxWidth="lg">
                  <SupportPage />
                </Container>
              </Box>
            </Box>
          </Box>
        </Suspense>
      </RequireRole>
    </ThemeProvider>
  );
}
