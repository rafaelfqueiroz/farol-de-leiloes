'use client';

import GoogleIcon from '@mui/icons-material/Google';
import Button from '@mui/material/Button';
import { useTranslations } from 'next-intl';
import { publicEnv } from '@/lib/env';

export interface GoogleSignInButtonProps {
  /**
   * `reauth` (SPEC-010 BR-010-13): the signed-in account proves again, with Google, that it is the
   * holder. The API seals the intent into the OAuth state cookie, starts NO session, and sends the
   * browser back to the privacy page with a one-time code.
   */
  intent?: 'signin' | 'reauth';
  /** `contained` when it is the one action of a screen ("Entrar com o Google" after an expiry). */
  variant?: 'outlined' | 'contained';
  /** Replaces the default text of the intent (from the catalogue). */
  label?: string;
}

/**
 * "Entrar com Google" (login and register, frames 1 and 2): starts the sign-in on the API, which
 * redirects to the provider and back to `/auth/callback`. With `intent="reauth"` it is "Confirmar
 * com o Google" and the return goes to `/profile/privacidade` instead.
 */
export default function GoogleSignInButton({
  intent = 'signin',
  variant = 'outlined',
  label,
}: GoogleSignInButtonProps) {
  const t = useTranslations('account');
  return (
    <Button
      fullWidth
      size="large"
      variant={variant}
      startIcon={<GoogleIcon />}
      onClick={() => {
        const query = intent === 'reauth' ? '?intent=reauth' : '';
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the Google sign-in starts on the API (a redirect to the provider), not on a Next page, so it needs a full-page navigation
        window.location.assign(`${publicEnv.apiUrl}/api/auth/google${query}`);
      }}
    >
      {label ?? (intent === 'reauth' ? t('googleReauth') : t('googleSignIn'))}
    </Button>
  );
}
