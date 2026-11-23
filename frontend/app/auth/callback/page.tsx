'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CancelOutlined from '@mui/icons-material/CancelOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import TimerOffOutlined from '@mui/icons-material/TimerOffOutlined';
import GoogleSignInButton from '@/app/components/account/GoogleSignInButton';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import { AuthFormPage, LoadingScreen, ResultScreen } from '@/app/components/patterns/PublicScreens';
import TermsAcceptance from '@/app/components/account/TermsAcceptance';
import { useCurrentLegal } from '@/app/components/account/use-current-legal';
import { useAuth } from '@/app/contexts/AuthContext';
import { apiFetch } from '@/lib/api-client';
import { readApiError } from '@/lib/api-error';
import { LEGAL_PATHS, versionsOf } from '@/lib/legal';
import { reportClientError } from '@/lib/report-client-error';

type Stage =
  | { name: 'loading' }
  // a first Google sign-in: the account is created only once the terms are accepted (BR-001-09)
  | { name: 'terms'; email: string; displayName: string | null; code: string }
  // the person declined: nothing was stored (BR-010-01)
  | { name: 'declined' }
  // the code lived past its time (60 s to 15 min): start again from Google
  | { name: 'expired' }
  | { name: 'error' };

// SPEC-001 BR-001-20: the return from Google carries a one-time `code`, never a session. The page
// trades it for the session through the BFF (POST /api/auth/google/exchange). For a person with
// no account yet it then asks for the terms (frame 4): "Criar conta" completes the sign-up
// (POST /api/auth/google/complete), "Cancelar" discards the waiting Google profile.
interface TermsStepProps {
  email: string;
  displayName: string | null;
  /** The one-time code of the waiting Google profile; spent by `complete`, deleted by `cancel`. */
  code: string;
  onSignedIn: () => Promise<void>;
  onDeclined: () => void;
  onExpired: () => void;
  onFailed: (error?: unknown) => void;
}

// BR-010-01, BR-010-27 (frame "Aceite do Google"): the account is created only once the documents
// shown here are accepted; the WhatsApp box is separate, optional and unticked. Declining deletes
// the waiting profile, so nothing is stored.
function TermsStep({
  email,
  displayName,
  code,
  onSignedIn,
  onDeclined,
  onExpired,
  onFailed,
}: TermsStepProps) {
  const t = useTranslations('authCallback');
  const tTerms = useTranslations('account.terms');
  const { state: legal, reload: reloadLegal } = useCurrentLegal();
  const [accepted, setAccepted] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [termsMissing, setTermsMissing] = useState(false);
  const [changed, setChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const accept = async () => {
    if (legal.status !== 'ready') return;
    setTermsMissing(!accepted);
    if (!accepted) return;
    setSubmitting(true);
    try {
      const response = await apiFetch('/api/auth/google/complete', {
        method: 'POST',
        json: { code, acceptTerms: true, ...versionsOf(legal.legal), whatsappConsent: whatsapp },
      });
      if (response.ok) {
        await onSignedIn();
        return;
      }
      const error = await readApiError(response);
      if (error.code === 'TERMS_VERSION_OUTDATED') {
        // the pending sign-up is kept (the code is not spent): read the new versions and accept again
        setChanged(true);
        setAccepted(false);
        reloadLegal();
        setSubmitting(false);
      } else if (error.code === 'INVALID_GOOGLE_CODE') {
        onExpired();
      } else {
        onFailed();
      }
    } catch (error: unknown) {
      onFailed(error);
    }
  };

  // Declining leaves nothing behind (SPEC-010 BR-010-01): the waiting profile is deleted.
  const decline = async () => {
    setSubmitting(true);
    await apiFetch('/api/auth/google/cancel', { method: 'POST', json: { code } })
      .then(() => undefined)
      .catch((error: unknown) => reportClientError(error, { where: 'auth/callback' }));
    onDeclined();
  };

  const summary = displayName
    ? t.rich('terms.summary', {
        name: displayName,
        email,
        strong: (chunks) => <strong>{chunks}</strong>,
      })
    : t.rich('terms.summaryNoName', { email, strong: (chunks) => <strong>{chunks}</strong> });

  return (
    <AuthFormPage title={t('terms.title')} summary={summary}>
      <Stack
        component="form"
        spacing={2}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void accept();
        }}
      >
        {changed && (
          <InlineAlert
            severity="warning"
            role="status"
            title={tTerms('changed.title')}
            action={
              <Button
                variant="outlined"
                component="a"
                href={LEGAL_PATHS.terms}
                target="_blank"
                rel="noopener noreferrer"
              >
                {tTerms('changed.action')}
              </Button>
            }
          >
            {tTerms('changed.callback')}
          </InlineAlert>
        )}
        <TermsAcceptance
          checked={accepted}
          onChange={(checked) => {
            setAccepted(checked);
            if (checked) setTermsMissing(false);
          }}
          error={termsMissing}
          whatsapp={whatsapp}
          onWhatsappChange={setWhatsapp}
          legal={legal}
          onRetryLegal={reloadLegal}
          compact
        />
        <Button
          type="submit"
          fullWidth
          size="large"
          variant="contained"
          disabled={submitting || legal.status !== 'ready'}
        >
          {submitting ? t('terms.submitting') : t('terms.submit')}
        </Button>
        <Button
          fullWidth
          size="large"
          variant="outlined"
          disabled={submitting}
          onClick={() => void decline()}
        >
          {t('terms.decline')}
        </Button>
      </Stack>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {changed ? t('terms.stillNotCreated') : t('terms.declineNote')}
      </Typography>
    </AuthFormPage>
  );
}

// SPEC-001 BR-001-20: the return from Google carries a one-time `code`, never a session. The page
// trades it for the session through the BFF (POST /api/auth/google/exchange). For a person with
// no account yet it then asks for the terms (SPEC-010 frame "Aceite do Google"): "Aceitar e criar
// conta" completes the sign-up (POST /api/auth/google/complete) with the versions shown and the
// optional WhatsApp choice, "Recusar e cancelar" discards the waiting Google profile.
function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loadUser } = useAuth();
  const t = useTranslations('authCallback');
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  // The code is single use: React's development double-run of effects must not spend it twice. It
  // is read before it is stripped from the address bar, and the terms step needs it afterwards.
  const exchanged = useRef(false);

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

      const data: { status: string; email?: string; name?: string } = await response.json();
      if (data.status === 'signed_in') {
        await signedIn();
        return;
      }
      if (data.status === 'terms_required' && typeof data.email === 'string') {
        setStage({
          name: 'terms',
          email: data.email,
          code: received,
          displayName: typeof data.name === 'string' && data.name !== '' ? data.name : null,
        });
        return;
      }
      setStage({ name: 'error' });
    };

    exchange().catch(fail);
  }, [searchParams, router, signedIn, fail]);

  if (stage.name === 'terms') {
    return (
      <TermsStep
        email={stage.email}
        displayName={stage.displayName}
        code={stage.code}
        onSignedIn={signedIn}
        onDeclined={() => setStage({ name: 'declined' })}
        onExpired={() => setStage({ name: 'expired' })}
        onFailed={fail}
      />
    );
  }

  if (stage.name === 'declined') {
    return (
      <ResultScreen
        tone="info"
        icon={CancelOutlined}
        title={t('declined.title')}
        description={t('declined.text')}
        focusTitle
      >
        <Button component={Link} href="/" variant="contained" size="large" fullWidth>
          {t('declined.action')}
        </Button>
      </ResultScreen>
    );
  }

  if (stage.name === 'expired') {
    return (
      <ResultScreen
        tone="error"
        icon={TimerOffOutlined}
        title={t('expired.title')}
        description={t('expired.text')}
        focusTitle
      >
        <GoogleSignInButton variant="contained" label={t('expired.action')} />
      </ResultScreen>
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
