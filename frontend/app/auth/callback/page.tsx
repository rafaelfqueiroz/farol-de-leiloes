'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useAuth } from '@/app/contexts/AuthContext';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loadUser } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');

    if (token) {
      // Store the token
      localStorage.setItem('token', token);

      // Load user data
      loadUser().then(() => {
        // Redirect to home page
        router.push('/');
      }).catch((error) => {
        console.error('Error loading user after OAuth:', error);
        router.push('/login');
      });
    } else {
      // No token, redirect to login
      router.push('/login');
    }
  }, [searchParams, router, loadUser]);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FAFAF9',
      }}
    >
      <CircularProgress size={48} sx={{ mb: 2 }} />
      <Typography variant="body1" color="text.secondary">
        Autenticando...
      </Typography>
    </Box>
  );
}
