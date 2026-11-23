'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Stack,
  TextField,
  Button,
  Typography,
  Alert,
  Divider,
  Link as MuiLink,
} from '@mui/material';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import { AuthFormPage } from '@/app/components/patterns/PublicScreens';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import GoogleSignInButton from '@/app/components/account/GoogleSignInButton';
import TermsAcceptance from '@/app/components/account/TermsAcceptance';
import { useCurrentLegal } from '@/app/components/account/use-current-legal';
import { ApiError, useApiErrorMessage } from '@/lib/api-error';
import { LEGAL_PATHS, versionsOf } from '@/lib/legal';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  registerFormErrors,
} from '@/lib/forms/register-form';

type FieldErrors = Partial<Record<'email' | 'password' | 'confirmPassword', string>>;

export default function RegisterPage() {
  const router = useRouter();
  const { register, loading: authLoading } = useAuth();
  const t = useTranslations('register');
  const tLogin = useTranslations('login');
  const tTerms = useTranslations('account.terms');
  const tAccount = useTranslations('account');
  const { state: legal, reload: reloadLegal } = useCurrentLegal();
  const apiErrorMessage = useApiErrorMessage();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  // BR-010-27: its own choice, unticked until the person ticks it
  const [whatsapp, setWhatsapp] = useState(false);
  // BR-010-01: a newer version was published while the form was open
  const [documentsChanged, setDocumentsChanged] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [termsMissing, setTermsMissing] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // BR-001-18: no registration while the first session lookup is pending (Enter in a field included)
    if (authLoading) return;
    setError('');
    // the versions sent are the ones the form showed; without them nothing is sent (BR-010-01)
    if (legal.status !== 'ready') return;
    const problems = registerFormErrors({
      name,
      email,
      password,
      confirmPassword,
      acceptTerms: accepted,
      whatsappConsent: whatsapp,
    });
    const invalid: FieldErrors = {};
    if (problems.password) {
      invalid.password = t('errors.passwordLength', {
        min: MIN_PASSWORD_LENGTH,
        max: MAX_PASSWORD_LENGTH,
      });
    }
    if (problems.confirmPassword) invalid.confirmPassword = t('errors.passwordMismatch');
    // BR-001-02: the acceptance blocks the submit on the client; the API refuses it as well
    setTermsMissing(problems.acceptTerms !== undefined);
    setFieldErrors(invalid);
    if (
      problems.name ||
      problems.email ||
      problems.acceptTerms ||
      Object.keys(invalid).length > 0
    ) {
      return;
    }

    setLoading(true);

    try {
      await register(email, password, name, {
        ...versionsOf(legal.legal),
        whatsappConsent: whatsapp,
      });
      router.push('/verify-email');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'TERMS_VERSION_OUTDATED') {
        // nothing was created: read the new documents and accept again
        setDocumentsChanged(true);
        setAccepted(false);
        reloadLegal();
      } else if (err instanceof ApiError && err.code === 'EMAIL_ALREADY_REGISTERED') {
        // frame 1.2: the error sits under the E-mail field
        setFieldErrors({ email: apiErrorMessage(err) });
      } else {
        setError(apiErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFormPage title={t('title')} summary={t('subtitle')}>
      {error && <Alert severity="error">{error}</Alert>}

      <Stack component="form" spacing={2} onSubmit={handleSubmit}>
        {documentsChanged && (
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
            {tTerms('changed.register')}
          </InlineAlert>
        )}
        <TextField
          fullWidth
          label={t('name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
        />

        <TextField
          fullWidth
          label={t('email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          error={Boolean(fieldErrors.email)}
          helperText={fieldErrors.email}
        />

        <TextField
          fullWidth
          label={t('password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          slotProps={{ htmlInput: { maxLength: MAX_PASSWORD_LENGTH } }}
          // the hint gives way to the error when the length is wrong
          error={Boolean(fieldErrors.password)}
          helperText={
            fieldErrors.password ??
            t('passwordHelper', { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH })
          }
        />

        <TextField
          fullWidth
          label={t('confirmPassword')}
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
          error={Boolean(fieldErrors.confirmPassword)}
          helperText={fieldErrors.confirmPassword}
        />

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
        />

        <Button
          fullWidth
          size="large"
          variant="contained"
          type="submit"
          disabled={loading || authLoading || legal.status !== 'ready'}
        >
          {loading ? t('submitting') : t('submit')}
        </Button>
      </Stack>

      <Divider>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {tLogin('or')}
        </Typography>
      </Divider>

      <GoogleSignInButton />
      <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
        {tAccount('googleSignUpNote')}
      </Typography>

      <Typography variant="body2" sx={{ textAlign: 'center' }}>
        <MuiLink component={Link} href="/login" variant="subtitle2">
          {t('hasAccount')}
        </MuiLink>
      </Typography>
    </AuthFormPage>
  );
}
