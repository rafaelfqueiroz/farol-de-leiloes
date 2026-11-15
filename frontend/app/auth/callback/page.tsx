'use client';

import { Suspense } from 'react';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LoadingScreen } from '@/app/components/patterns/PublicScreens';
import { useAuth } from '@/app/contexts/AuthContext';
import { reportClientError } from '@/lib/report-client-error';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loadUser } = useAuth();
  const t = useTranslations('authCallback');

  useEffect(() => {
    const token = searchParams.get('token');

    if (token) {
      // Store the token
      localStorage.setItem('token', token);

      // Load user data
      loadUser()
        .then(() => {
          // Redirect to home page
          router.push('/');
        })
        .catch((error) => {
          reportClientError(error, { where: 'auth/callback' });
          router.push('/login');
        });
    } else {
      // No token, redirect to login
      router.push('/login');
    }
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
