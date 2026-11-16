'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { AuthFormPage, LoadingScreen, ResultScreen } from '@/app/components/patterns/PublicScreens';
import TermsAcceptance from '@/app/components/account/TermsAcceptance';
import { useAuth } from '@/app/contexts/AuthContext';
import { apiFetch } from '@/lib/api-client';
import { readApiError } from '@/lib/api-error';
import { reportClientError } from '@/lib/report-client-error';

type Stage =
  | { name: 'loading' }
  // a first Google sign-in: the account is created only once the terms are accepted (BR-001-09)
  | { name: 'terms'; email: string; submitting: boolean }
  | { name: 'error' };

// SPEC-001 BR-001-20: the return from Google carries a one-time `code`, never a session. The page
// trades it for the session through the BFF (POST /api/auth/google/exchange). For a person with
// no account yet it then asks for the terms (frame 4): "Criar conta" completes the sign-up
// (POST /api/auth/google/complete), "Cancelar" discards the waiting Google profile.
function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loadUser } = useAuth();
  const t = useTranslations('authCallback');
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  const [accepted, setAccepted] = useState(false);
  // The code is single use: React's development double-run of effects must not spend it twice. It
  // is read before it is stripped from the address bar, and the terms step needs it afterwards.
  const exchanged = useRef(false);
  const code = useRef<string | null>(null);

  const fail = useCallback((error?: unknown) => {
    if (error !== undefined) reportClientError(error, { where: 'auth/callback' });
    setStage({ name: 'error' });
  }, []);

  const signedIn = useCallback(async () => {
    // SC-02: the BFF has set the session cookie; the answer carries no token
    await loadUser();
    router.replace('/');
  }, [loadUser, router]);

  useEffect(() => {
    // Stripping the code below changes the search params and runs this effect again: by then the
    // exchange is under way and must not be mistaken for a visit without a code.
    if (exchanged.current) return;
    const received = searchParams.get('code');

    if (!received) {
      // No code, redirect to login. `replace` everywhere: this page never stays in the history.
      router.replace('/login');
      return;
    }
    exchanged.current = true;
    code.current = received;
    // The code is a credential in the making: take it out of the address bar (and so out of the
    // history entry and any later copy of the URL) as soon as it is read.
    window.history.replaceState(null, '', window.location.pathname);

    const exchange = async () => {
      const response = await apiFetch('/api/auth/google/exchange', {
        method: 'POST',
        json: { code: received },
      });
      if (!response.ok) {
        const error = await readApiError(response);
        // BR-001-08 has its own message on the login page (frame 2.4); any other refusal is frame 4.3
        if (error.code === 'GOOGLE_EMAIL_NOT_VERIFIED') {
          router.replace(`/login?error=${encodeURIComponent(error.code)}`);
        } else {
          setStage({ name: 'error' });
        }
        return;
      }

      const data: { status: string; email?: string } = await response.json();
      if (data.status === 'signed_in') {
        await signedIn();
        return;
      }
      if (data.status === 'terms_required' && typeof data.email === 'string') {
        setStage({ name: 'terms', email: data.email, submitting: false });
        return;
      }
      setStage({ name: 'error' });
    };

    exchange().catch(fail);
  }, [searchParams, router, signedIn, fail]);

  const accept = async () => {
    if (stage.name !== 'terms' || !accepted || code.current === null) return;
    setStage({ ...stage, submitting: true });
    try {
      const response = await apiFetch('/api/auth/google/complete', {
        method: 'POST',
        json: { code: code.current, acceptTerms: true },
      });
      if (!response.ok) {
        setStage({ name: 'error' });
        return;
      }
      await signedIn();
    } catch (error: unknown) {
      fail(error);
    }
  };

  // Declining leaves nothing behind (SPEC-010 BR-010-01): the waiting profile is deleted, then
  // the person lands on the login.
  const decline = async () => {
    if (stage.name !== 'terms' || code.current === null) return;
    setStage({ ...stage, submitting: true });
    await apiFetch('/api/auth/google/cancel', { method: 'POST', json: { code: code.current } })
      .then(() => undefined)
      .catch((error: unknown) => reportClientError(error, { where: 'auth/callback' }));
    router.replace('/login');
  };

  if (stage.name === 'terms') {
    return (
      <AuthFormPage title={t('terms.title')} summary={t('terms.summary', { email: stage.email })}>
        <Stack
          component="form"
          spacing={2}
          onSubmit={(event) => {
            event.preventDefault();
            void accept();
          }}
        >
          <TermsAcceptance checked={accepted} onChange={setAccepted} />
          <Button
            type="submit"
            fullWidth
            size="large"
            variant="contained"
            disabled={!accepted || stage.submitting}
          >
            {stage.submitting ? t('terms.submitting') : t('terms.submit')}
          </Button>
          <Button
            fullWidth
            size="large"
            variant="outlined"
            disabled={stage.submitting}
            onClick={() => void decline()}
          >
            {t('terms.decline')}
          </Button>
        </Stack>
      </AuthFormPage>
    );
  }

  if (stage.name === 'error') {
    return (
      <ResultScreen
        tone="error"
        icon={ErrorOutlineIcon}
        title={t('error.title')}
        description={t('error.hint')}
      >
        <Button component={Link} href="/login" variant="contained" size="large" fullWidth>
          {t('error.backToLogin')}
        </Button>
      </ResultScreen>
    );
  }

  return <LoadingScreen title={t('authenticating')} />;
}

export default function AuthCallbackPage() {
  const t = useTranslations('authCallback');

  return (
    <Suspense fallback={<LoadingScreen title={t('fallback')} />}>
      <AuthCallbackContent />
    </Suspense>
  );
}
