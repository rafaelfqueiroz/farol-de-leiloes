'use client';

import GoogleIcon from '@mui/icons-material/Google';
import Button from '@mui/material/Button';
import { useTranslations } from 'next-intl';
import { publicEnv } from '@/lib/env';

/**
 * "Entrar com Google" (login and register, frames 1 and 2): starts the sign-in on the API, which
 * redirects to the provider and back to `/auth/callback`.
 */
export default function GoogleSignInButton() {
  const t = useTranslations('account');
  return (
    <Button
      fullWidth
      size="large"
      variant="outlined"
      startIcon={<GoogleIcon />}
      onClick={() => {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the Google sign-in starts on the API (a redirect to the provider), not on a Next page, so it needs a full-page navigation
        window.location.assign(`${publicEnv.apiUrl}/api/auth/google`);
      }}
    >
      {t('googleSignIn')}
    </Button>
  );
}
