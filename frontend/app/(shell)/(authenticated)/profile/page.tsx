'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import PersonOutlined from '@mui/icons-material/PersonOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import DevicesOutlined from '@mui/icons-material/DevicesOutlined';
import PageHeader from '@/app/components/patterns/PageHeader';
import PageShell from '@/app/components/patterns/PageShell';
import StatusBadge from '@/app/components/patterns/StatusBadge';
import { shellContentMinHeight } from '@/app/components/patterns/shell-content';
import { reportClientError } from '@/lib/report-client-error';
import { apiFetch, apiJson } from '@/lib/api-client';
import { formatPhone } from '@/lib/phone';
import { ApiError, useApiErrorMessage } from '@/lib/api-error';

// BR-001-13
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// DS-15: the card titles are the page's h2s; DS-11: h5 is the card-title variant
function CardHeading({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box
        sx={(theme) => ({
          width: theme.spacing(4.5),
          height: theme.spacing(4.5),
          borderRadius: 1,
          backgroundColor: 'primary.main',
          color: 'primary.contrastText',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        {icon}
      </Box>
      <Typography variant="h5" component="h2">
        {title}
      </Typography>
    </Box>
  );
}

// the answer of VALIDATION_FAILED names the refused fields (AR-38)
function refusedFields(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return [];
  const fields = error.context.fields;
  return Array.isArray(fields) ? fields : [];
}

export default function ProfilePage() {
  const { user, isAuthenticated, loading: authLoading, loadUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const t = useTranslations('profile');
  const tCommon = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // follow the signed-in user (it arrives, or refreshes after a save) while rendering, not in an
  // effect, so the form never paints a stale name first
  const [syncedUser, setSyncedUser] = useState(user);
  if (user !== syncedUser) {
    setSyncedUser(user);
    if (user) setName(user.name || '');
  }

  // The phone is not in the session user: read it from the full profile
  useEffect(() => {
    if (!isAuthenticated) return;
    const loadFullProfile = async () => {
      try {
        const response = await apiFetch('/api/auth/profile/full');
        if (response.ok) {
          const data: { phone?: string } = await response.json();
          // the API stores E.164; the person sees it as they would type it
          setPhone(formatPhone(data.phone));
        }
      } catch (err) {
        reportClientError(err, { where: 'profile page' });
      }
    };
    void loadFullProfile();
  }, [isAuthenticated]);

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPhoneError(false);
    setSavingAccount(true);

    try {
      // BR-001-25: the page sends name and phone only, never the e-mail; the phone goes as typed
      // and the API normalises it (BR-001-27)
      await apiJson('/api/auth/profile', { method: 'PATCH', json: { name, phone } });
      setToast(t('account.saved'));
      await loadUser();
    } catch (err: unknown) {
      if (refusedFields(err).includes('phone')) {
        setPhoneError(true);
      } else {
        setError(apiErrorMessage(err));
      }
    } finally {
      setSavingAccount(false);
    }
  };

  const hasPassword = user?.providers?.includes('local') ?? false;

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
      setPasswordError(true);
      return;
    }
    setPasswordError(false);
    setSavingPassword(true);

    try {
      if (hasPassword) {
        await apiJson('/api/auth/change-password', {
          method: 'POST',
          json: { currentPassword, newPassword },
        });
        setToast(t('password.changed'));
      } else {
        await apiJson('/api/auth/set-password', { method: 'POST', json: { newPassword } });
        setToast(t('password.created'));
      }
      setCurrentPassword('');
      setNewPassword('');
      // a Google account that created its password now has the `local` provider
      if (!hasPassword) await loadUser();
    } catch (err: unknown) {
      setError(apiErrorMessage(err));
    } finally {
      setSavingPassword(false);
    }
  };

  if (authLoading) {
    return (
      <Box
        // #42: fills the AppShell content area, not the whole viewport
        sx={(theme) => ({
          ...shellContentMinHeight(theme),
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        })}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    // DS-14: the shell owns <main>; the page sets no width or padding of its own
    <>
      <PageShell width="reading">
        <PageHeader title={t('title')} summary={t('subtitle')} />
        <Stack spacing={3}>
          {error && <Alert severity="error">{error}</Alert>}

          <Card>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <CardHeading icon={<PersonOutlined fontSize="small" />} title={t('account.title')} />
              <Divider sx={{ mb: 2 }} />
              <Stack component="form" spacing={2} onSubmit={handleSaveAccount}>
                <TextField
                  fullWidth
                  label={t('account.name')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
                {/* BR-001-26, D-63: the e-mail is the account's identity and is read-only for every
                  account; an unconfirmed one says so under the field */}
                <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <TextField
                    fullWidth
                    label={t('account.email')}
                    type="email"
                    value={user?.email ?? ''}
                    disabled
                    helperText={t('account.emailHelper')}
                  />
                  {user?.emailVerified === false && (
                    <StatusBadge status="neutral" label={t('account.unconfirmed')} />
                  )}
                </Stack>
                <TextField
                  fullWidth
                  label={t('account.phone')}
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setPhoneError(false);
                  }}
                  type="tel"
                  autoComplete="tel"
                  error={phoneError}
                  helperText={phoneError ? t('account.phoneInvalid') : t('account.phoneHelper')}
                />
                <Button type="submit" variant="contained" disabled={savingAccount}>
                  {savingAccount ? (
                    <CircularProgress size={24} aria-label={tCommon('loading')} />
                  ) : (
                    tCommon('save')
                  )}
                </Button>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <CardHeading icon={<LockOutlined fontSize="small" />} title={t('password.title')} />
              {!hasPassword && (
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                  {t('password.googleIntro')}
                </Typography>
              )}
              <Divider sx={{ mb: 2 }} />
              <Stack component="form" spacing={2} onSubmit={handleSavePassword}>
                {hasPassword && (
                  <TextField
                    fullWidth
                    label={t('password.current')}
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                )}
                <TextField
                  fullWidth
                  label={t('password.new')}
                  type="password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setPasswordError(false);
                  }}
                  required
                  autoComplete="new-password"
                  slotProps={{ htmlInput: { maxLength: MAX_PASSWORD_LENGTH } }}
                  error={passwordError}
                  helperText={t(passwordError ? 'password.tooShort' : 'password.newHelper', {
                    min: MIN_PASSWORD_LENGTH,
                    max: MAX_PASSWORD_LENGTH,
                  })}
                />
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', color: 'text.secondary' }}
                >
                  <DevicesOutlined aria-hidden fontSize="small" />
                  <Typography variant="body2">
                    {t(hasPassword ? 'password.devicesOnChange' : 'password.devicesOnCreate')}
                  </Typography>
                </Stack>
                <Button type="submit" variant="contained" disabled={savingPassword}>
                  {savingPassword ? (
                    <CircularProgress size={24} aria-label={tCommon('loading')} />
                  ) : (
                    t(hasPassword ? 'password.change' : 'password.create')
                  )}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </PageShell>

      {/* DS toast: a short past-tense confirmation */}
      <Snackbar
        open={toast !== null}
        autoHideDuration={5000}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setToast(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="success"
          variant="filled"
          closeText={tCommon('close')}
          onClose={() => setToast(null)}
        >
          {toast}
        </Alert>
      </Snackbar>
    </>
  );
}
