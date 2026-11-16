'use client';

import { Suspense } from 'react';
import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LoadingScreen } from '@/app/components/patterns/PublicScreens';
import { useAuth } from '@/app/contexts/AuthContext';
import { readApiError } from '@/lib/api-error';
import { reportClientError } from '@/lib/report-client-error';

// SPEC-001 BR-001-20: the return from Google carries a one-time `code`, never a session. The page
// trades it for the session through the BFF (POST /api/auth/google/exchange).
function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loadUser } = useAuth();
  const t = useTranslations('authCallback');
  // The code is single use: React's development double-run of effects must not spend it twice.
  const exchanged = useRef(false);

  useEffect(() => {
    // Stripping the code below changes the search params and runs this effect again: by then the
    // exchange is under way and must not be mistaken for a visit without a code.
    if (exchanged.current) return;
    const code = searchParams.get('code');

    if (!code) {
      // No code, redirect to login. `replace` everywhere: this page never stays in the history.
      router.replace('/login');
      return;
    }
    exchanged.current = true;
    // The code is a credential in the making: take it out of the address bar (and so out of the
    // history entry and any later copy of the URL) as soon as it is read.
    window.history.replaceState(null, '', window.location.pathname);

    const post = (path: string) =>
      fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

    const exchange = async () => {
      const response = await post('/api/auth/google/exchange');
      if (!response.ok) {
        // The login page shows the catalogue message of the code (INVALID_GOOGLE_CODE...).
        const error = await readApiError(response);
        router.replace(`/login?error=${encodeURIComponent(error.code)}`);
        return;
      }

      const data: { status: string; accessToken?: string } = await response.json();
      if (data.status === 'signed_in' && data.accessToken) {
        localStorage.setItem('token', data.accessToken);
        await loadUser();
        router.replace('/');
        return;
      }

      // `terms_required`: a first Google sign-in, which creates the account only after the terms
      // are accepted (BR-001-09). The terms screen ships with its approved frame in the next
      // SPEC-001 PR (DS-30); until then the sign-in cannot complete. Declining leaves nothing
      // behind (SPEC-010 BR-010-01), so the waiting profile is deleted before the login page.
      await post('/api/auth/google/cancel').catch((error: unknown) =>
        reportClientError(error, { where: 'auth/callback' }),
      );
      router.replace('/login?error=GOOGLE_SIGN_IN_FAILED');
    };

    exchange().catch((error: unknown) => {
      reportClientError(error, { where: 'auth/callback' });
      router.replace('/login');
    });
  }, [searchParams, router, loadUser]);

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
