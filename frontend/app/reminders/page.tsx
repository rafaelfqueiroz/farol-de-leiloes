'use client';

import { Suspense } from 'react';
import { Box, Container, ThemeProvider, CircularProgress } from '@mui/material';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
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
        backgroundColor: '#FAFAF9',
      }}
    >
      <CircularProgress />
    </Box>
  );
}

export default function Reminders() {
  return (
    <ThemeProvider theme={theme}>
      <Suspense fallback={<RemindersPageLoading />}>
        <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: '#FAFAF9' }}>
          <Sidebar activeView="reminders" />

          <Box sx={{ flexGrow: 1, ml: '72px' }}>
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
