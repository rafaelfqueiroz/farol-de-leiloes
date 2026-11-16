'use client';

import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import { useId } from 'react';
import { useTranslations } from 'next-intl';

export interface TermsAcceptanceProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Shows the "accept the terms" error under the block. */
  error?: boolean;
}

/**
 * BR-001-02, BR-001-09 (frames 1 and 4): the checkbox and its sentence are one block, so a sentence
 * that wraps keeps flowing beside the box; the error sits under the block and is tied to it with
 * `aria-describedby`. The sentence is plain text until SPEC-010 (#10) publishes the legal pages.
 */
export default function TermsAcceptance({
  checked,
  onChange,
  error = false,
}: TermsAcceptanceProps) {
  const t = useTranslations('account.terms');
  const errorId = useId();

  return (
    <FormControl error={error} required={false}>
      <FormControlLabel
        // DS-16: the whole row is the target; a wrapped sentence stays beside the box
        sx={(theme) => ({ alignItems: 'flex-start', minHeight: theme.spacing(5.5), m: 0 })}
        control={
          <Checkbox
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            slotProps={{ input: { 'aria-describedby': error ? errorId : undefined } }}
            sx={{ pt: 1.25, pl: 0 }}
          />
        }
        label={t('label')}
        slotProps={{ typography: { variant: 'body2', sx: { pt: 1.25 } } }}
      />
      {error && <FormHelperText id={errorId}>{t('required')}</FormHelperText>}
    </FormControl>
  );
}
