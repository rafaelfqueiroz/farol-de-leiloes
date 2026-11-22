'use client';

import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import PrivacyTipOutlined from '@mui/icons-material/PrivacyTipOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MuiLink from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import BusyButton from '@/app/components/patterns/BusyButton';
import DateText from '@/app/components/patterns/DateText';
import InlineAlert from '@/app/components/patterns/InlineAlert';
import { useAuth } from '@/app/contexts/AuthContext';
import { apiFetch } from '@/lib/api-client';
import { readApiError, useApiErrorMessage } from '@/lib/api-error';
import {
  LEGAL_PATHS,
  PRIVACY_PAGE_PATH,
  versionsOf,
  type LegalDocumentData,
  type LegalDocumentType,
} from '@/lib/legal';
import { reportClientError } from '@/lib/report-client-error';
import { useCurrentLegal } from './use-current-legal';

const DOCUMENT_ICONS = { terms: DescriptionOutlined, privacy: PrivacyTipOutlined } as const;

function DocumentRow({ document }: { document: LegalDocumentData }) {
  const t = useTranslations('consentDialogs.terms');
  const Icon = DOCUMENT_ICONS[document.type];
  return (
    <ListItem disableGutters sx={{ alignItems: 'flex-start' }}>
      <ListItemIcon sx={(theme) => ({ minWidth: theme.spacing(4), mt: 0.5 })}>
        <Icon aria-hidden fontSize="small" />
      </ListItemIcon>
      <ListItemText
        slotProps={{ primary: { variant: 'body2' } }}
        primary={t.rich('document', {
          type: document.type,
          version: document.version,
          // opens in a new tab: the dialog, and what was ticked in it, stay where they are
          link: (chunks) => (
            <MuiLink
              href={LEGAL_PATHS[document.type]}
              target="_blank"
              rel="noopener noreferrer"
              underline="always"
            >
              {chunks}
            </MuiLink>
          ),
          date: () => <DateText value={document.effectiveAt} />,
        })}
      />
    </ListItem>
  );
}

/**
 * SPEC-010 BR-010-05 (frame "Reaceite"): a newer version of the terms or the privacy policy must be
 * accepted before the account is used. It cannot be dismissed (no Esc, no scrim click): the person
 * accepts, signs out, or goes to the privacy page to see, export or delete their data (DL-010-03).
 * Focus is trapped in the dialog (MUI) and the safe way out, "Sair da conta", is always there. The
 * versions accepted are the ones listed here, read from the public API when it opens; if a newer one
 * came out meanwhile (TERMS_VERSION_OUTDATED) the dialog says so, reads again and asks again.
 * Opened by `AccountConsentGate`, once.
 */
export default function TermsReacceptanceDialog() {
  const t = useTranslations('consentDialogs.terms');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const { user, logout, refreshUser } = useAuth();
  const { state: legal, reload } = useCurrentLegal();
  const [accepted, setAccepted] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [newerVersion, setNewerVersion] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const titleId = useId();
  const introId = useId();

  // what is still to accept, as /api/auth/me says; with no list (a refusal read it not yet) both
  const pending = new Set<LegalDocumentType>(
    (user?.documents ?? []).flatMap((document) =>
      document.type === 'terms' || document.type === 'privacy' ? [document.type] : [],
    ),
  );
  const documents =
    legal.status === 'ready'
      ? ([legal.legal.terms, legal.legal.privacy] as const).filter(
          (document) => pending.size === 0 || pending.has(document.type),
        )
      : [];

  const accept = async () => {
    if (legal.status !== 'ready' || !accepted || accepting) return;
    setAccepting(true);
    setFailure(null);
    setNewerVersion(false);
    try {
      const response = await apiFetch('/api/privacy/accept', {
        method: 'POST',
        json: versionsOf(legal.legal),
      });
      if (!response.ok) {
        const error = await readApiError(response);
        if (error.code === 'TERMS_VERSION_OUTDATED') {
          // a newer version came out while the person read: read it, and accept again
          setNewerVersion(true);
          setAccepted(false);
          reload();
        } else {
          setFailure(apiErrorMessage(error));
        }
        return;
      }
      // the account is up to date; /api/auth/me no longer asks, and the gate closes this dialog.
      // Nothing that was refused meanwhile is retried: the pages load again when visited.
      await refreshUser();
    } catch (error: unknown) {
      reportClientError(error, { where: 'TermsReacceptanceDialog' });
      setFailure(apiErrorMessage(error));
    } finally {
      setAccepting(false);
    }
  };

  const signOut = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <Dialog
      open
      // BR-010-05: not dismissible. Esc and the scrim do nothing; the actions below are the exits.
      disableEscapeKeyDown
      onClose={() => undefined}
      aria-labelledby={titleId}
      aria-describedby={introId}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle id={titleId} variant="h4" component="h2">
        {t('title')}
      </DialogTitle>
      <DialogContent>
        <Typography id={introId} variant="body1">
          {t('intro')}
        </Typography>
        {newerVersion ? (
          <Box sx={{ mt: 2 }}>
            <InlineAlert severity="warning" role="status">
              {t('newer')}
            </InlineAlert>
          </Box>
        ) : null}
        {legal.status === 'failed' ? (
          <Box sx={{ mt: 2 }}>
            <InlineAlert
              severity="error"
              role="alert"
              action={
                <Button variant="outlined" onClick={reload}>
                  {t('retry')}
                </Button>
              }
            >
              {t('loadFailed')}
            </InlineAlert>
          </Box>
        ) : null}
        <List disablePadding sx={{ mt: 1 }}>
          {documents.map((document) => (
            <DocumentRow key={document.type} document={document} />
          ))}
        </List>
        <FormControlLabel
          // DS-16: the whole row is the target
          sx={(theme) => ({ mx: 0, minHeight: theme.spacing(5.5) })}
          control={
            <Checkbox
              checked={accepted}
              disabled={accepting || legal.status !== 'ready'}
              onChange={(event) => setAccepted(event.target.checked)}
            />
          }
          label={t('acknowledge')}
        />
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
          {t.rich('rights', {
            link: (chunks) => (
              <MuiLink component={Link} href={PRIVACY_PAGE_PATH} underline="always">
                {chunks}
              </MuiLink>
            ),
          })}
        </Typography>
        {failure ? (
          <Box sx={{ mt: 2 }}>
            <InlineAlert severity="error" role="alert">
              {failure}
            </InlineAlert>
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" disabled={accepting} onClick={() => void signOut()}>
          {t('signOut')}
        </Button>
        <BusyButton
          variant="contained"
          busy={accepting}
          busyLabel={t('accepting')}
          disabled={!accepted || legal.status !== 'ready'}
          onClick={() => void accept()}
        >
          {t('accept')}
        </BusyButton>
      </DialogActions>
    </Dialog>
  );
}
