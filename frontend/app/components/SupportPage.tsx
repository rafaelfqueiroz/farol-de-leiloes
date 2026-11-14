'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Box,
  Typography,
  TextField,
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Paper,
  Snackbar,
  Alert,
  CircularProgress,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import SendIcon from '@mui/icons-material/Send';
import { ApiError, readApiError, useApiErrorMessage } from '@/lib/api-error';

const FAQ_KEYS = [
  'howAuctionsWork',
  'plans',
  'reminders',
  'aiSearch',
  'cancel',
  'contact',
] as const;

export default function SupportPage() {
  const apiErrorMessage = useApiErrorMessage();
  const t = useTranslations('support');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new ApiError('UNAUTHENTICATED', {}, 401);
      }

      const response = await fetch('/api/support', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, description }),
      });

      if (!response.ok) {
        throw await readApiError(response);
      }

      setSnackbar({
        open: true,
        message: t('form.success'),
        severity: 'success',
      });
      setTitle('');
      setDescription('');
    } catch (error: unknown) {
      setSnackbar({
        open: true,
        message: apiErrorMessage(error),
        severity: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          {t('title')}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {t('intro')}
        </Typography>
      </Box>

      {/* FAQ Section */}
      <Box sx={{ mb: 5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <HelpOutlineIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h6" fontWeight={600}>
            {t('faqHeading')}
          </Typography>
        </Box>

        {FAQ_KEYS.map((key) => (
          <Accordion
            key={key}
            sx={{
              '&:before': { display: 'none' },
              boxShadow: 'none',
              border: '1px solid',
              borderColor: 'divider',
              mb: 1,
              borderRadius: '8px !important',
              '&:first-of-type': { borderRadius: '8px !important' },
              '&:last-of-type': { borderRadius: '8px !important' },
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography fontWeight={500}>{t(`faq.${key}.question`)}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography color="text.secondary">{t(`faq.${key}.answer`)}</Typography>
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>

      {/* Support Form */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <SendIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h6" fontWeight={600}>
            {t('form.heading')}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('form.description')}
        </Typography>

        <Box component="form" onSubmit={handleSubmit}>
          <TextField
            label={t('form.title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            required
            inputProps={{ minLength: 3, maxLength: 200 }}
            sx={{ mb: 2 }}
          />
          <TextField
            label={t('form.body')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            required
            multiline
            rows={4}
            inputProps={{ minLength: 10, maxLength: 2000 }}
            sx={{ mb: 3 }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={loading || !title.trim() || !description.trim()}
            startIcon={loading ? <CircularProgress size={18} /> : <SendIcon />}
          >
            {loading ? t('form.submitting') : t('form.submit')}
          </Button>
        </Box>
      </Paper>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
