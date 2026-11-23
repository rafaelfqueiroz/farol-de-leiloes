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
import PageHeader from '@/app/components/patterns/PageHeader';
import PageShell from '@/app/components/patterns/PageShell';
import { apiJson } from '@/lib/api-client';
import { useApiErrorMessage } from '@/lib/api-error';

/**
 * SPEC-009 BR-009-05 / BR-009-08: the limits of the API and the permission option. The form keeps its
 * layout until the new support page (part 3 of #9, after its frame is approved): until then the option
 * is not offered, so every request is sent with the permission off (the API's default too).
 */
const SUBJECT_MAX = 200;
const SUBJECT_MIN = 3;
const MESSAGE_MAX = 5000;
const MESSAGE_MIN = 10;

/** The answer of POST /api/support (BR-009-06): the protocol to show the requester. */
interface SupportRequestCreated {
  protocol: string;
}

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
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
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
      // SC-02: the session cookie goes with the request; a signed-out visitor gets UNAUTHENTICATED
      const created = await apiJson<SupportRequestCreated>('/api/support', {
        method: 'POST',
        json: { subject, message, allowDataAccess: false },
      });

      setSnackbar({
        open: true,
        message: t('form.success', { protocol: created.protocol }),
        severity: 'success',
      });
      setSubject('');
      setMessage('');
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
    <>
      {/* DS-14: the shell owns <main>; this is a reading page (text and a form) */}
      <PageShell width="reading">
        <PageHeader title={t('title')} summary={t('intro')} />

        {/* FAQ Section */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <HelpOutlineIcon sx={{ color: 'text.secondary' }} />
            <Typography variant="h3" component="h2">
              {t('faqHeading')}
            </Typography>
          </Box>

          {FAQ_KEYS.map((key) => (
            <Accordion
              key={key}
              sx={(theme) => ({
                '&:before': { display: 'none' },
                boxShadow: 'none',
                border: 1,
                borderColor: 'divider',
                mb: 1,
                borderRadius: `${theme.shape.panelRadius}px !important`,
              })}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle1" component="span">
                  {t(`faq.${key}.question`)}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t(`faq.${key}.answer`)}
                </Typography>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>

        {/* Support Form */}
        <Paper
          variant="outlined"
          sx={(theme) => ({ p: 3, borderRadius: `${theme.shape.panelRadius}px` })}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <SendIcon sx={{ color: 'text.secondary' }} />
            <Typography variant="h3" component="h2">
              {t('form.heading')}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            {t('form.description')}
          </Typography>

          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              label={t('form.subject')}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              fullWidth
              required
              inputProps={{ minLength: SUBJECT_MIN, maxLength: SUBJECT_MAX }}
              sx={{ mb: 2 }}
            />
            <TextField
              label={t('form.message')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              fullWidth
              required
              multiline
              rows={4}
              inputProps={{ minLength: MESSAGE_MIN, maxLength: MESSAGE_MAX }}
              sx={{ mb: 3 }}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={loading || !subject.trim() || !message.trim()}
              startIcon={loading ? <CircularProgress size={18} /> : <SendIcon />}
            >
              {loading ? t('form.submitting') : t('form.submit')}
            </Button>
          </Box>
        </Paper>
      </PageShell>

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
    </>
  );
}
