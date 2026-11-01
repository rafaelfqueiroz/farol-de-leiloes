'use client';

import { Suspense } from 'react';
import { Box, Container, CircularProgress } from '@mui/material';
import RequireRole from '@/app/components/RequireRole';
import RemindersPage from '@/app/components/RemindersPage';
import { shellContentMinHeight } from '@/app/components/patterns/shell-content';

function RemindersPageLoading() {
  return (
    <Box
      sx={(theme) => ({
        // #42: fills the AppShell content area, not the whole viewport
        ...shellContentMinHeight(theme),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <CircularProgress />
    </Box>
  );
}

export default function Reminders() {
  return (
    <RequireRole minimumRole="standard" featureName="Lembretes">
      <Suspense fallback={<RemindersPageLoading />}>
        {/* #42: the AppShell owns the top bar, navigation and <main>; pt no longer offsets a fixed bar */}
        <Box sx={{ pt: 2, pb: 4 }}>
          <Container maxWidth="lg">
            <RemindersPage />
          </Container>
        </Box>
      </Suspense>
    </RequireRole>
  );
}
