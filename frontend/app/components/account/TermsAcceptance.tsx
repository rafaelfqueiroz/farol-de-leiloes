'use client';

import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import MuiLink from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import { LEGAL_PATHS } from '@/lib/legal';
import type { LegalState } from './use-current-legal';

export interface TermsAcceptanceProps {
  /** The terms box (required). */
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Shows the "accept the terms" error under the block. */
  error?: boolean;
  /** The optional WhatsApp box, its own choice, unticked by default (BR-010-27). */
  whatsapp: boolean;
  onWhatsappChange: (checked: boolean) => void;
  /** The versions in force, from `useCurrentLegal`: what the sentence names and what is sent. */
  legal: LegalState;
  onRetryLegal: () => void;
  /** The shorter WhatsApp help of the Google step. */
  compact?: boolean;
}

function DocumentLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    // opens in a new tab so what was typed in the form is not lost
    <MuiLink href={href} target="_blank" rel="noopener noreferrer" underline="always">
      {children}
    </MuiLink>
  );
}

/**
 * SPEC-010 BR-010-01, BR-010-27 (frames "Cadastro" and "Aceite do Google"): the terms checkbox with
 * its two links to the CURRENT documents, the versions it stands for, and the separate, optional,
 * unticked WhatsApp checkbox. Shared by `/register` and the Google step of `/auth/callback`. The
 * error sits under the block and is tied to the box with `aria-describedby` (DS-21).
 */
export default function TermsAcceptance({
  checked,
  onChange,
  error = false,
  whatsapp,
  onWhatsappChange,
  legal,
  onRetryLegal,
  compact = false,
}: TermsAcceptanceProps) {
  const t = useTranslations('account.terms');
  const errorId = useId();
  const versionsId = useId();
  const whatsappHelpId = useId();

  const describedBy =
    [legal.status === 'ready' ? versionsId : null, error ? errorId : null]
      .filter((id): id is string => id !== null)
      .join(' ') || undefined;

  return (
    <FormControl component="fieldset" error={error} required={false} sx={{ gap: 0.5 }}>
      <FormLabel component="legend" sx={{ color: 'text.primary', typography: 'subtitle2' }}>
        {t('legend')}
      </FormLabel>

      {legal.status === 'failed' ? (
        <InlineAlert
          severity="error"
          role="alert"
          action={
            <Button variant="outlined" onClick={onRetryLegal}>
              {t('retry')}
            </Button>
          }
        >
          {t('loadFailed')}
        </InlineAlert>
      ) : null}

      <FormControlLabel
        // DS-16: the whole row is the target; a wrapped sentence stays beside the box
        sx={(theme) => ({ alignItems: 'flex-start', minHeight: theme.spacing(5.5), m: 0 })}
        control={
          <Checkbox
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            slotProps={{ input: { 'aria-describedby': describedBy } }}
            sx={{ pt: 1.25, pl: 0 }}
          />
        }
        label={t.rich('label', {
          terms: (chunks) => <DocumentLink href={LEGAL_PATHS.terms}>{chunks}</DocumentLink>,
          privacy: (chunks) => <DocumentLink href={LEGAL_PATHS.privacy}>{chunks}</DocumentLink>,
        })}
        slotProps={{ typography: { variant: 'body2', sx: { pt: 1.25 } } }}
      />
      {legal.status === 'loading' ? (
        <Skeleton variant="text" width="60%" role="status" aria-label={t('loading')} />
      ) : null}
      {legal.status === 'ready' ? (
        <Typography id={versionsId} variant="caption" sx={{ color: 'text.secondary', pl: 4.5 }}>
          {t('versions', {
            terms: legal.legal.terms.version,
            privacy: legal.legal.privacy.version,
            draft: String(legal.legal.terms.draft || legal.legal.privacy.draft),
          })}
        </Typography>
      ) : null}
      {error ? (
        <FormHelperText
          id={errorId}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 4.5 }}
        >
          <ErrorOutlineOutlined aria-hidden fontSize="inherit" />
          {t('required')}
        </FormHelperText>
      ) : null}

      <FormControlLabel
        sx={(theme) => ({ alignItems: 'flex-start', minHeight: theme.spacing(5.5), m: 0, mt: 1 })}
        control={
          <Checkbox
            checked={whatsapp}
            onChange={(event) => onWhatsappChange(event.target.checked)}
            slotProps={{ input: { 'aria-describedby': whatsappHelpId } }}
            sx={{ pt: 1.25, pl: 0 }}
          />
        }
        label={t('whatsappLabel')}
        slotProps={{ typography: { variant: 'body2', sx: { pt: 1.25 } } }}
      />
      <Typography id={whatsappHelpId} variant="caption" sx={{ color: 'text.secondary', pl: 4.5 }}>
        {compact ? t('whatsappHelpShort') : t('whatsappHelp')}
      </Typography>
    </FormControl>
  );
}
