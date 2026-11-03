'use client';

import { useState } from 'react';
import {
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { TZDate } from '@date-fns/tz';
import { subHours } from 'date-fns';
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import DeleteIcon from '@mui/icons-material/Delete';
import { useReminders, ReminderChannel } from '../contexts/RemindersContext';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useApiErrorMessage } from '@/lib/api-error';
import { parseDate } from '@/lib/dates';
import { TIME_ZONE } from '@/i18n/config';
import DateField from './DateField';
import DateText from './patterns/DateText';

interface ReminderButtonProps {
  auctionCode: string;
  auctionTitle: string;
  auctionDate?: string;
}

export default function ReminderButton({
  auctionCode,
  auctionTitle,
  auctionDate,
}: ReminderButtonProps) {
  const { isAuthenticated, role } = useAuth();
  const { hasReminderForAuction, getReminderForAuction, createReminder, deleteReminder } =
    useReminders();
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<ReminderChannel>('EMAIL');
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [description, setDescription] = useState('');

  const hasReminder = hasReminderForAuction(auctionCode);
  const existingReminder = getReminderForAuction(auctionCode);

  const isPremium = role === 'standard' || role === 'premium' || role === 'admin';

  const handleClick = () => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    setOpen(true);
    setError(null);

    if (!scheduledAt && auctionDate) {
      // AR-23: one hour before the auction, computed on the Brasília clock
      const start = parseDate(auctionDate);
      if (start.kind === 'instant') {
        // (TZDate#toISOString writes an offset; the API takes a UTC instant)
        setScheduledAt(
          new Date(subHours(new TZDate(start.date, TIME_ZONE), 1).getTime()).toISOString(),
        );
      }
    }
  };

  const handleClose = () => {
    setOpen(false);
    setError(null);
  };

  const handleCreate = async () => {
    if (!scheduledAt) {
      setError('Selecione a data e hora do lembrete');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await createReminder({
        auctionId: auctionCode,
        channel,
        scheduledAt,
        description: description || undefined,
      });

      if (result) {
        handleClose();
      } else {
        setError(apiErrorMessage(null));
      }
    } catch (err: unknown) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!existingReminder) return;

    setLoading(true);
    setError(null);

    try {
      const success = await deleteReminder(existingReminder._id);
      if (success) {
        handleClose();
      } else {
        setError(apiErrorMessage(null));
      }
    } catch (err: unknown) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <IconButton
        onClick={handleClick}
        size="small"
        sx={{
          color: hasReminder ? 'warning.main' : 'action.active',
          '&:hover': {
            color: 'warning.main',
          },
        }}
        title={hasReminder ? 'Gerenciar lembrete' : 'Criar lembrete'}
      >
        {hasReminder ? <NotificationsActiveIcon /> : <NotificationsIcon />}
      </IconButton>

      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{hasReminder ? 'Gerenciar Lembrete' : 'Criar Lembrete'}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {auctionTitle || `Leilão ${auctionCode}`}
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {hasReminder && existingReminder ? (
              <Box sx={{ mb: 2 }}>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Lembrete agendado para <DateText value={existingReminder.scheduledAt} withTime />{' '}
                  via {existingReminder.channel}
                </Alert>
                {existingReminder.description && (
                  <Typography variant="body2" color="text.secondary">
                    Nota: {existingReminder.description}
                  </Typography>
                )}
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <FormControl fullWidth>
                  <InputLabel id="channel-label">Canal de notificação</InputLabel>
                  <Select
                    labelId="channel-label"
                    value={channel}
                    label="Canal de notificação"
                    onChange={(e) => setChannel(e.target.value as ReminderChannel)}
                  >
                    <MenuItem value="EMAIL">E-mail</MenuItem>
                    <MenuItem value="SMS" disabled={!isPremium}>
                      SMS {!isPremium && '(Standard/Premium)'}
                    </MenuItem>
                    <MenuItem value="WHATSAPP" disabled={!isPremium}>
                      WhatsApp {!isPremium && '(Standard/Premium)'}
                    </MenuItem>
                  </Select>
                </FormControl>

                <DateField
                  type="datetime"
                  label="Data e hora do lembrete"
                  value={scheduledAt}
                  onChange={setScheduledAt}
                  minuteStep={10}
                  helperText="O lembrete deve ser antes do início do leilão"
                />

                <TextField
                  label="Nota (opcional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  multiline
                  rows={2}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                  helperText={`${description.length}/500 caracteres`}
                />
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          {hasReminder ? (
            <Button
              onClick={handleDelete}
              color="destructive"
              startIcon={loading ? <CircularProgress size={16} /> : <DeleteIcon />}
              disabled={loading}
            >
              Remover Lembrete
            </Button>
          ) : (
            <Button
              onClick={handleCreate}
              variant="contained"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} /> : null}
            >
              Criar Lembrete
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
