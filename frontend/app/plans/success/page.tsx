'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Box, Container, Typography, Button } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useAuth } from '../../contexts/AuthContext';

export default function PlansSuccessPage() {
  const router = useRouter();
  const t = useTranslations('plansResult.success');
  const { refreshUser } = useAuth();

  useEffect(() => {
    void refreshUser();
    const timer = setTimeout(() => {
      router.push('/search');
    }, 5000);
    return () => clearTimeout(timer);
  }, [refreshUser, router]);

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
        <CheckCircleOutlineIcon sx={{ fontSize: 80, color: 'success.main', mb: 2 }} />
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>
          {t('title')}
        </Typography>
        <Typography variant="body1" sx={{ mb: 4, color: 'text.secondary' }}>
          {t('description')}
        </Typography>
        <Button variant="contained" onClick={() => router.push('/search')}>
          {t('goToSearch')}
        </Button>
      </Container>
    </Box>
  );
}
