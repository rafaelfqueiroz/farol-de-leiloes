'use client';

import type { SvgIconComponent } from '@mui/icons-material';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import BusyButton from './BusyButton';

export interface ConfirmDialogProps {
  open: boolean;
  /** The question, naming the object: "Cancelar a jornada de Casa em Lagoa Nova?" */
  title: string;
  /** What will be lost and who is affected; irreversible actions say so in words. */
  description: ReactNode;
  /** More paragraphs under the description (SPEC-012 frames 15 and 16). */
  children?: ReactNode;
  /**
   * What follows from confirming, one line each with its Outlined icon (DS-25): "O plano continua
   * valendo até 14/12/2026". Read as part of the dialog's description.
   */
  consequences?: readonly { icon: SvgIconComponent; text: string }[];
  /** The verb again, never "OK" or "Sim". */
  confirmLabel: string;
  /** The safe action. Defaults to the catalogue's "Cancelar". */
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  /** Destructive colour for the confirm button (DS-06). Default true. */
  destructive?: boolean;
  /** The confirmed action is running: the confirm button is busy and the dialog cannot be dismissed. */
  busy?: boolean;
  /** What the confirm button says while busy ("Cancelando…"); required with `busy`. */
  busyLabel?: string;
}

// DS-27: every destructive action confirms here; the safe action comes first and has focus.
export default function ConfirmDialog({
  open,
  title,
  description,
  children,
  consequences,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
  destructive = true,
  busy = false,
  busyLabel,
}: ConfirmDialogProps) {
  const t = useTranslations('patterns.confirmDialog');
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Dialog
      open={open}
      // Esc closes; a stray click on the backdrop must not dismiss a decision
      onClose={(_event, reason) => {
        if (reason !== 'backdropClick' && !busy) onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      slotProps={{ paper: { role: 'alertdialog' } }}
    >
      <DialogTitle id={titleId} variant="h4" component="h2">
        {title}
      </DialogTitle>
      <DialogContent>
        <Box id={descriptionId}>
          <DialogContentText>{description}</DialogContentText>
          {children}
          {consequences && consequences.length > 0 ? (
            <List disablePadding sx={{ mt: 1 }}>
              {consequences.map(({ icon: Icon, text }) => (
                <ListItem key={text} disableGutters sx={{ alignItems: 'flex-start' }}>
                  <ListItemIcon sx={(theme) => ({ minWidth: theme.spacing(4), mt: 0.5 })}>
                    <Icon aria-hidden fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={text} slotProps={{ primary: { variant: 'body2' } }} />
                </ListItem>
              ))}
            </List>
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus -- an alertdialog opens on its safe action, never the destructive one (DS-21) */}
        <Button variant="outlined" onClick={onClose} autoFocus>
          {cancelLabel ?? t('cancel')}
        </Button>
        <BusyButton
          variant="contained"
          color={destructive ? 'destructive' : 'primary'}
          onClick={onConfirm}
          busy={busy}
          busyLabel={busyLabel ?? confirmLabel}
        >
          {confirmLabel}
        </BusyButton>
      </DialogActions>
    </Dialog>
  );
}
