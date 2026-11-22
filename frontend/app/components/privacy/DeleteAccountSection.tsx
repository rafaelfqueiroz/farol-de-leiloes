'use client';

import InventoryOutlined from '@mui/icons-material/Inventory2Outlined';
import LockResetOutlined from '@mui/icons-material/LockResetOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import NotificationsOffOutlined from '@mui/icons-material/NotificationsOffOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import GoogleSignInButton from '@/app/components/account/GoogleSignInButton';
import ConfirmDialog from '@/app/components/patterns/ConfirmDialog';
import { useAuth } from '@/app/contexts/AuthContext';
import { apiFetch } from '@/lib/api-client';
import { ApiError, readApiError, useApiErrorMessage } from '@/lib/api-error';
import { deleteAccountBody } from '@/lib/forms/delete-account-form';
import { reportClientError } from '@/lib/report-client-error';
import { PRIVACY_API } from './privacy-api';
import PrivacySection from './PrivacySection';

/** Where the browser goes once the account is closed (public, outside the shell). */
export const ACCOUNT_CLOSED_PATH = '/conta-encerrada';

/** What the return from Google puts in the address: the code, or why there is none. */
interface ReauthReturn {
  code: string | null;
  error: string | null;
}

/**
 * Reads the return of a Google re-authentication from the address and takes it out at once: the code
 * is a credential (single use, 60 seconds), so it is kept only in this component's state, replaced in
 * the history entry, and never logged or sent anywhere but the delete-account call (SC-02, SC-15).
 */
function useReauthReturn(): ReauthReturn | null {
  const [returned, setReturned] = useState<ReauthReturn | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('reauth');
    const error = params.get('reauthError');
    if (code === null && error === null) return;
    window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is an external system, readable only after mount
    setReturned({ code: code === '' ? null : code, error });
  }, []);
  return returned;
}

/**
 * SPEC-010 BR-010-13, BR-010-14 (frame "Excluir minha conta"): the danger zone, last on the page, and
 * the confirmation that goes through the system's `ConfirmDialog` (DS-27). The identity is proved
 * AGAIN: the current password, or for an account that signs in only with Google a new Google
 * sign-in, which comes back to this page with a one-time code (the OAuth flow carries the `reauth`
 * intent, so no session is started). The dialog cannot be dismissed while it deletes. On success the
 * BFF has cleared the session cookie and the browser goes to the closed-account screen.
 */
export default function DeleteAccountSection() {
  const t = useTranslations('privacy.delete');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const { user } = useAuth();
  const returned = useReauthReturn();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [googleCode, setGoogleCode] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const passwordId = useId();

  // the account may prove itself with a password; a Google-only account proves itself with Google
  const providers = user?.providers ?? [];
  const hasPassword = providers.includes('local');
  const hasGoogle = providers.includes('google');
  const method = hasPassword ? 'password' : hasGoogle ? 'google' : null;

  // back from Google: reopen the confirmation with the code (or with why there is none)
  const [seenReturn, setSeenReturn] = useState<ReauthReturn | null>(null);
  if (returned !== null && returned !== seenReturn) {
    setSeenReturn(returned);
    setOpen(true);
    if (returned.code !== null) setGoogleCode(returned.code);
    if (returned.error !== null) setFailure(apiErrorMessage(new ApiError(returned.error)));
  }

  const close = () => {
    if (deleting) return;
    setOpen(false);
    setPassword('');
    setAcknowledged(false);
    setWrongPassword(false);
    setFailure(null);
  };

  const confirm = async () => {
    if (deleting || method === null) return;
    const request = deleteAccountBody(
      method === 'password'
        ? { method, password, acknowledged }
        : { method, googleCode: googleCode ?? '', acknowledged },
    );
    if (!request.ok) return;
    setDeleting(true);
    setFailure(null);
    setWrongPassword(false);
    try {
      const response = await apiFetch(PRIVACY_API.deleteAccount, {
        method: 'POST',
        json: request.body,
      });
      if (response.ok) {
        // closed: the session is already dead and the BFF cleared its cookie. Stay busy while the
        // browser moves on, so a second click cannot repeat it.
        router.replace(ACCOUNT_CLOSED_PATH);
        return;
      }
      const error = await readApiError(response);
      if (error.code === 'CURRENT_PASSWORD_INCORRECT') {
        setWrongPassword(true);
      } else if (error.code === 'INVALID_GOOGLE_CODE') {
        // single use and 60 seconds: it is gone either way, confirm with Google again
        setGoogleCode(null);
        setFailure(t('googleExpired'));
      } else if (error.code === 'REAUTHENTICATION_UNAVAILABLE') {
        setFailure(t('unavailable'));
      } else {
        setFailure(apiErrorMessage(error));
      }
    } catch (error: unknown) {
      reportClientError(error, { where: 'DeleteAccountSection' });
      setFailure(apiErrorMessage(error));
    }
    setDeleting(false);
  };

  const proofGiven = method === 'password' ? password !== '' : googleCode !== null;

  const controls =
    method === 'password' ? (
      <TextField
        id={passwordId}
        fullWidth
        label={t('password')}
        type="password"
        autoComplete="current-password"
        value={password}
        disabled={deleting}
        onChange={(event) => {
          setPassword(event.target.value);
          setWrongPassword(false);
        }}
        error={wrongPassword}
        helperText={wrongPassword ? t('wrongPassword') : undefined}
      />
    ) : method === 'google' ? (
      <Stack spacing={1}>
        <Typography variant="body2">{t('googleText')}</Typography>
        <GoogleSignInButton intent="reauth" />
        {googleCode !== null ? (
          <Typography role="status" variant="caption" sx={{ color: 'text.secondary' }}>
            {t('googleConfirmed')}
          </Typography>
        ) : null}
      </Stack>
    ) : null;

  const consequences = [
    { icon: LogoutOutlined, text: t('consequences.logout') },
    { icon: NotificationsOffOutlined, text: t('consequences.notifications') },
    { icon: InventoryOutlined, text: t('consequences.kept') },
    { icon: LockResetOutlined, text: t('consequences.irreversible') },
  ];

  return (
    <PrivacySection title={t('title')} description={t('description')} danger>
      <List disablePadding>
        {consequences.map(({ icon: Icon, text }) => (
          <ListItem key={text} disableGutters sx={{ alignItems: 'flex-start' }}>
            <ListItemIcon sx={(theme) => ({ minWidth: theme.spacing(4), mt: 0.5 })}>
              <Icon aria-hidden fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={text} slotProps={{ primary: { variant: 'body2' } }} />
          </ListItem>
        ))}
      </List>
      <Box>
        <Button variant="outlined" color="destructive" onClick={() => setOpen(true)}>
          {t('open')}
        </Button>
      </Box>
      <ConfirmDialog
        open={open}
        title={t('dialogTitle')}
        description={t('dialogText')}
        confirmLabel={t('confirm')}
        cancelLabel={t('keep')}
        busy={deleting}
        busyLabel={t('deleting')}
        error={failure}
        controls={controls}
        acknowledge={{ label: t('acknowledge'), checked: acknowledged, onChange: setAcknowledged }}
        confirmDisabled={method === null || !proofGiven}
        onConfirm={() => void confirm()}
        onClose={close}
      />
    </PrivacySection>
  );
}
