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
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import DeleteIcon from '@mui/icons-material/Delete';
import { useReminders, ReminderChannel } from '../contexts/RemindersContext';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';

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
  const { hasReminderForAuction, getReminderForAuction, createReminder, deleteReminder } = useReminders();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<ReminderChannel>('EMAIL');
  const [scheduledAt, setScheduledAt] = useState('');
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
      const date = new Date(auctionDate);
      date.setHours(date.getHours() - 1);
      setScheduledAt(formatDateTimeLocal(date));
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
        scheduledAt: new Date(scheduledAt).toISOString(),
        description: description || undefined,
      });

      if (result) {
        handleClose();
      } else {
        setError('Erro ao criar lembrete. Tente novamente.');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao criar lembrete');
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
        setError('Erro ao remover lembrete. Tente novamente.');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao remover lembrete');
    } finally {
      setLoading(false);
    }
  };

  const formatDateTimeLocal = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const formatDisplayDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
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
        <DialogTitle>
          {hasReminder ? 'Gerenciar Lembrete' : 'Criar Lembrete'}
        </DialogTitle>
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
                  Lembrete agendado para {formatDisplayDate(existingReminder.scheduledAt)} via {existingReminder.channel}
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

                <TextField
                  label="Data e hora do lembrete"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                  helperText="O lembrete deve ser antes do início do leilão"
                />

                <TextField
                  label="Nota (opcional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  multiline
                  rows={2}
                  fullWidth
                  inputProps={{ maxLength: 500 }}
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
              color="error"
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
