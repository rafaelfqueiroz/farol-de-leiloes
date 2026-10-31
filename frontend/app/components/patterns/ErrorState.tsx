'use client';

import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';

export interface ErrorStateProps {
  title: string;
  /** The catalogue message for the error code (AR-39). Never raw exception text (SC-15). */
  message: string;
  /** The support code, shown in caption. */
  code?: string;
  onRetry: () => void;
  /** Heading level of the title; follows the page outline (DS-15). */
  titleComponent?: 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

export default function ErrorState({
  title,
  message,
  code,
  onRetry,
  titleComponent = 'h2',
}: ErrorStateProps) {
  const t = useTranslations('patterns.errorState');

  return (
    <Stack
      role="alert"
      spacing={2}
      sx={{ alignItems: 'center', textAlign: 'center', px: 2, py: 6 }}
    >
      <Box
        sx={(theme) => ({
          width: theme.spacing(7),
          height: theme.spacing(7),
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'error.soft',
          color: 'error.main',
        })}
      >
        <ErrorOutlineOutlined aria-hidden fontSize="medium" />
      </Box>
      <Stack spacing={0.5} sx={{ maxWidth: '36em' }}>
        <Typography variant="h4" component={titleComponent}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {message}
        </Typography>
      </Stack>
      <Button variant="outlined" startIcon={<RefreshOutlined />} onClick={onRetry}>
        {t('retry')}
      </Button>
      {code ? (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('code', { code })}
        </Typography>
      ) : null}
    </Stack>
  );
}
