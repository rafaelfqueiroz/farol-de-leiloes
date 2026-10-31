'use client';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  /** The question, naming the object: "Cancelar a jornada de Casa em Lagoa Nova?" */
  title: string;
  /** What will be lost and who is affected; irreversible actions say so in words. */
  description: string;
  /** The verb again, never "OK" or "Sim". */
  confirmLabel: string;
  /** The safe action. Defaults to the catalogue's "Cancelar". */
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  /** Destructive colour for the confirm button (DS-06). Default true. */
  destructive?: boolean;
}

// DS-27: every destructive action confirms here; the safe action comes first and has focus.
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
  destructive = true,
}: ConfirmDialogProps) {
  const t = useTranslations('patterns.confirmDialog');
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Dialog
      open={open}
      // Esc closes; a stray click on the backdrop must not dismiss a decision
      onClose={(_event, reason) => {
        if (reason !== 'backdropClick') onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      slotProps={{ paper: { role: 'alertdialog' } }}
    >
      <DialogTitle id={titleId} variant="h4" component="h2">
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id={descriptionId}>{description}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="outlined" onClick={onClose} autoFocus>
          {cancelLabel ?? t('cancel')}
        </Button>
        <Button
          variant="contained"
          color={destructive ? 'destructive' : 'primary'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
