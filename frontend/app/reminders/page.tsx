'use client';

import { Suspense } from 'react';
import { Box, Container, ThemeProvider, CircularProgress } from '@mui/material';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import { useSidebar } from '../contexts/SidebarContext';
import RemindersPage from '../components/RemindersPage';
import theme from '../theme';

function RemindersPageLoading() {
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

export default function Reminders() {
  const { sidebarWidth } = useSidebar();

  return (
    <ThemeProvider theme={theme}>
      <Suspense fallback={<RemindersPageLoading />}>
        <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: '#FFFFFF' }}>
          <Sidebar activeView="reminders" />

          <Box sx={{ flexGrow: 1, ml: `${sidebarWidth}px`, transition: 'margin-left 0.3s ease' }}>
            <TopBar />

            <Box component="main" sx={{ pt: 10, pb: 4 }}>
              <Container maxWidth="lg">
                <RemindersPage />
              </Container>
            </Box>
          </Box>
        </Box>
      </Suspense>
    </ThemeProvider>
  );
}
