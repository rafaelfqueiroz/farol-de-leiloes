'use client';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import BusyButton from '@/app/components/patterns/BusyButton';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import { useAuth } from '@/app/contexts/AuthContext';
import { apiFetch } from '@/lib/api-client';
import { readApiError, useApiErrorMessage } from '@/lib/api-error';
import { reportClientError } from '@/lib/report-client-error';

type Answer = 'granted' | 'declined';

/**
 * SPEC-010 BR-010-27 (frame "Pergunta única do WhatsApp"): an account that existed before the
 * consent was asked is asked once, at the next visit, after the documents (never together).
 * "Agora não" is an answer too (`declined`) and the question is not asked again; Esc means the same.
 * A click on the scrim does nothing. Saying yes switches no notice on by itself. Opened by
 * `AccountConsentGate`.
 */
export default function WhatsappPromptDialog() {
  const t = useTranslations('consentDialogs.whatsapp');
  const apiErrorMessage = useApiErrorMessage();
  const { refreshUser } = useAuth();
  const [saving, setSaving] = useState<Answer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const titleId = useId();
  const textId = useId();

  const answer = async (action: Answer) => {
    if (saving !== null) return;
    setSaving(action);
    setFailure(null);
    try {
      const response = await apiFetch('/api/privacy/whatsapp-consent', {
        method: 'POST',
        json: { action, method: 'existing_account_prompt' },
      });
      if (!response.ok) {
        setFailure(apiErrorMessage(await readApiError(response)));
        return;
      }
      // the question is answered: /api/auth/me stops asking and the gate closes this dialog
      await refreshUser();
    } catch (error: unknown) {
      reportClientError(error, { where: 'WhatsappPromptDialog' });
      setFailure(apiErrorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog
      open
      // Esc is "Agora não"; the scrim is not an answer
      onClose={(_event, reason) => {
        if (reason === 'escapeKeyDown') void answer('declined');
      }}
      aria-labelledby={titleId}
      aria-describedby={textId}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id={titleId} variant="h4" component="h2">
        {t('title')}
      </DialogTitle>
      <DialogContent>
        <Box id={textId}>
          <DialogContentText>{t('question')}</DialogContentText>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1.5 }}>
            {t('note')}
          </Typography>
        </Box>
        {failure ? (
          <Box sx={{ mt: 2 }}>
            <InlineAlert severity="error" role="alert">
              {failure}
            </InlineAlert>
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          variant="outlined"
          disabled={saving !== null}
          onClick={() => void answer('declined')}
        >
          {t('later')}
        </Button>
        <BusyButton
          variant="contained"
          busy={saving !== null}
          busyLabel={t('saving')}
          onClick={() => void answer('granted')}
        >
          {t('accept')}
        </BusyButton>
      </DialogActions>
    </Dialog>
  );
}
