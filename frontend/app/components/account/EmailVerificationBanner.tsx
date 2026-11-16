'use client';

import Button from '@mui/material/Button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import ShellBanner from '@/app/components/patterns/ShellBanner';
import { useAuth } from '@/app/contexts/AuthContext';
import { ApiError, useApiErrorMessage } from '@/lib/api-error';

type Resend = { name: 'idle' | 'sending' | 'sent' } | { name: 'failed'; message: string };

function UnconfirmedNotice({ email }: { email: string }) {
  const t = useTranslations('account.emailBanner');
  const apiErrorMessage = useApiErrorMessage();
  const { resendVerificationEmail, refreshUser } = useAuth();
  const [resend, setResend] = useState<Resend>({ name: 'idle' });

  const sendLink = async () => {
    setResend({ name: 'sending' });
    try {
      await resendVerificationEmail();
      setResend({ name: 'sent' });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'EMAIL_ALREADY_VERIFIED') {
        // confirmed meanwhile (another tab, the link itself): the banner goes away with the flag
        await refreshUser();
        return;
      }
      setResend({ name: 'failed', message: apiErrorMessage(error) });
    }
  };

  // frame 5.3: once sent, the notice turns informative and the action goes, so links are not
  // requested in a row
  if (resend.name === 'sent') {
    return <ShellBanner severity="info">{t('sent', { email })}</ShellBanner>;
  }

  const action = (
    <Button color="inherit" onClick={() => void sendLink()} disabled={resend.name === 'sending'}>
      {resend.name === 'sending' ? t('resending') : t('resend')}
    </Button>
  );
  // frame 5, error: the error text takes the place of the warning in the same banner
  if (resend.name === 'failed') {
    return (
      <ShellBanner severity="error" action={action}>
        {resend.message}
      </ShellBanner>
    );
  }
  return (
    <ShellBanner severity="warning" action={action}>
      {t('unconfirmed')}
    </ShellBanner>
  );
}

/**
 * BR-001-04 (frame 5): the one global warning for an account whose e-mail is not confirmed. It
 * fills the `AppShell` banner slot, so it shows on every signed-in page and disappears as soon as
 * the account becomes confirmed. Google accounts arrive confirmed and guests have no account, so
 * neither sees it.
 */
export default function EmailVerificationBanner() {
  const { user } = useAuth();
  if (!user || user.emailVerified !== false) return null;
  // one resend state per account: a different person signing in starts clean
  return <UnconfirmedNotice key={user._id} email={user.email} />;
}
