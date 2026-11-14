'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Box, Container, Typography, Button } from '@mui/material';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';

export default function PlansCancelPage() {
  const router = useRouter();
  const t = useTranslations('plansResult.cancel');

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
        <CancelOutlinedIcon sx={{ fontSize: 80, color: 'error.main', mb: 2 }} />
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>
          {t('title')}
        </Typography>
        <Typography variant="body1" sx={{ mb: 4, color: 'text.secondary' }}>
          {t('description')}
        </Typography>
        <Button variant="contained" onClick={() => router.push('/plans')}>
          {t('back')}
        </Button>
      </Container>
    </Box>
  );
}
