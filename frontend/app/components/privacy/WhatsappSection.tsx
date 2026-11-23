'use client';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import DateText from '@/app/components/patterns/DateText';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import StatusBadge from '@/app/components/patterns/StatusBadge';
import { useAuth } from '@/app/contexts/AuthContext';
import { apiFetch } from '@/lib/api-client';
import { readApiError, useApiErrorMessage } from '@/lib/api-error';
import { reportClientError } from '@/lib/report-client-error';
import { PRIVACY_API, whatsappConsentSchema, type WhatsappConsent } from './privacy-api';
import PrivacySection from './PrivacySection';

export interface WhatsappSectionProps {
  consent: WhatsappConsent;
  onChange: (consent: WhatsappConsent) => void;
}

// SPEC-010 BR-010-27 (frame "Avisos por WhatsApp"): the consent has its own switch, apart from the
// terms. Turning it off takes effect at once (the API stops sending, and records it with the time);
// turning it on again records the consent of the text in force. Having consented switches no
// notice on by itself, and the page says so.
export default function WhatsappSection({ consent, onChange }: WhatsappSectionProps) {
  const t = useTranslations('privacy.whatsapp');
  const apiErrorMessage = useApiErrorMessage();
  const { refreshUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const labelId = useId();
  const on = consent.state === 'granted';

  const toggle = async (granted: boolean) => {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const response = await apiFetch(PRIVACY_API.whatsapp, {
        method: 'POST',
        json: { action: granted ? 'granted' : 'withdrawn', method: 'privacy_page' },
      });
      if (!response.ok) {
        setFailure(apiErrorMessage(await readApiError(response)));
        return;
      }
      const parsed = whatsappConsentSchema.safeParse(await response.json());
      if (parsed.success) onChange(parsed.data);
      // any answer, given or withdrawn, answers the one-time question (the API says so in /auth/me):
      // the shared account state learns it, or the prompt would ask again and a "Agora não" would
      // overwrite what was just chosen here (BR-010-27)
      await refreshUser();
    } catch (error: unknown) {
      reportClientError(error, { where: 'WhatsappSection' });
      setFailure(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const when = consent.at;
  const stateLine = (() => {
    if (consent.state === 'granted' && when) {
      return t.rich('grantedAt', {
        version: consent.textVersion ?? '',
        date: () => <DateText value={when} withTime />,
      });
    }
    if (consent.state === 'withdrawn' && when) {
      return t.rich('withdrawnAt', { date: () => <DateText value={when} withTime /> });
    }
    if (consent.state === 'declined' && when) {
      return t.rich('declinedAt', { date: () => <DateText value={when} withTime /> });
    }
    return t('none');
  })();

  return (
    <PrivacySection title={t('title')} description={t('description')}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
      >
        <Stack spacing={1} sx={{ minWidth: 0 }}>
          <Typography id={labelId} variant="subtitle2" component="strong">
            {t('switch')}
          </Typography>
          {/* the state is announced when it changes, politely: it is the result of the switch */}
          <Stack
            role="status"
            direction="row"
            useFlexGap
            spacing={1}
            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
          >
            <StatusBadge status={on ? 'onTime' : 'cancelled'} label={on ? t('on') : t('off')} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {saving ? t('saving') : stateLine}
            </Typography>
          </Stack>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('note')}
          </Typography>
        </Stack>
        <Box sx={{ flexShrink: 0 }}>
          <Switch
            checked={on}
            disabled={saving}
            onChange={(event) => void toggle(event.target.checked)}
            // MUI's Switch is a checkbox input; `role="switch"` says what it is to a screen reader
            slotProps={{ input: { role: 'switch', 'aria-labelledby': labelId } }}
          />
        </Box>
      </Stack>
      {failure ? (
        <InlineAlert severity="error" role="alert">
          {failure}
        </InlineAlert>
      ) : null}
    </PrivacySection>
  );
}
