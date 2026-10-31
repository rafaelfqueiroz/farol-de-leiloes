'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Typography,
  Card,
  CardContent,
  IconButton,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Skeleton,
} from '@mui/material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import 'dayjs/locale/pt-br';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import NotificationsIcon from '@mui/icons-material/Notifications';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { useReminders, Reminder, ReminderChannel } from '../contexts/RemindersContext';
import { useAuth } from '../contexts/AuthContext';

const CHANNEL_ICONS: Record<ReminderChannel, React.ReactElement> = {
  EMAIL: <EmailIcon fontSize="small" />,
  SMS: <SmsIcon fontSize="small" />,
  WHATSAPP: <WhatsAppIcon fontSize="small" />,
};

const CHANNEL_LABELS: Record<ReminderChannel, string> = {
  EMAIL: 'E-mail',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function formatAddress(auction: Reminder['auction']): string {
  const parts = [auction.city, auction.state].filter(Boolean);
  return parts.join(', ') || 'Localização não informada';
}

export default function RemindersPage() {
  const router = useRouter();
  const { reminders, loading, deleteReminder, updateReminder } = useReminders();
  const { role } = useAuth();

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedReminder, setSelectedReminder] = useState<Reminder | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit form state
  const [editChannel, setEditChannel] = useState<ReminderChannel>('EMAIL');
  const [editScheduledAt, setEditScheduledAt] = useState<Dayjs | null>(null);
  const [editDescription, setEditDescription] = useState('');

  const isPremium = role === 'standard' || role === 'premium' || role === 'admin';

  // Filter only pending reminders and sort by scheduledAt
  const upcomingReminders = reminders
    .filter((r) => r.status === 'PENDING')
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const handleOpenEditDialog = (reminder: Reminder) => {
    setSelectedReminder(reminder);
    setEditChannel(reminder.channel);
    setEditScheduledAt(dayjs(reminder.scheduledAt));
    setEditDescription(reminder.description || '');
    setError(null);
    setEditDialogOpen(true);
  };

  const handleCloseEditDialog = () => {
    setEditDialogOpen(false);
    setSelectedReminder(null);
    setError(null);
  };

  const handleOpenDeleteDialog = (reminder: Reminder) => {
    setSelectedReminder(reminder);
    setError(null);
    setDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setSelectedReminder(null);
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (!selectedReminder || !editScheduledAt) {
      setError('Selecione a data e hora do lembrete');
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const success = await updateReminder(selectedReminder._id, {
        channel: editChannel,
        scheduledAt: editScheduledAt.toISOString(),
        description: editDescription || undefined,
      });

      if (success) {
        handleCloseEditDialog();
      } else {
        setError('Erro ao atualizar lembrete. Tente novamente.');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar lembrete');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedReminder) return;

    setActionLoading(true);
    setError(null);

    try {
      const success = await deleteReminder(selectedReminder._id);
      if (success) {
        handleCloseDeleteDialog();
      } else {
        setError('Erro ao remover lembrete. Tente novamente.');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao remover lembrete');
    } finally {
      setActionLoading(false);
    }
  };

  const handleNavigateToAuction = (auctionCode: string) => {
    router.push(`/auction/${auctionCode}`);
  };

  if (loading) {
    return (
      <Box>
        <Typography variant="h4" fontWeight={600} sx={{ mb: 1 }}>
          Meus Lembretes
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Gerencie seus lembretes de leilões
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rounded" height={120} />
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" fontWeight={600} sx={{ mb: 1 }}>
        Meus Lembretes
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Gerencie seus lembretes de leilões
      </Typography>

      {upcomingReminders.length === 0 ? (
        <Card sx={{ textAlign: 'center', py: 6 }}>
          <CardContent>
            <NotificationsIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
              Nenhum lembrete agendado
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Adicione lembretes aos leilões para receber notificações antes do início
            </Typography>
            <Button variant="contained" onClick={() => router.push('/search')}>
              Buscar leilões
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {upcomingReminders.map((reminder) => (
            <Card key={reminder._id}>
              <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
                      {reminder.auction.title || `Leilão ${reminder.auction.code}`}
                    </Typography>
                    <Chip
                      icon={CHANNEL_ICONS[reminder.channel]}
                      label={CHANNEL_LABELS[reminder.channel]}
                      size="small"
                      variant="outlined"
                    />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {formatAddress(reminder.auction)}
                  </Typography>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Typography variant="body2">
                      <strong>Agendado para:</strong> {formatDate(reminder.scheduledAt)}
                    </Typography>
                    {reminder.description && (
                      <Typography variant="body2" color="text.secondary">
                        <strong>Nota:</strong> {reminder.description}
                      </Typography>
                    )}
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <IconButton
                    onClick={() => handleNavigateToAuction(reminder.auction.code)}
                    size="small"
                    title="Ver leilão"
                    sx={{ color: 'info.main' }}
                  >
                    <OpenInNewIcon />
                  </IconButton>
                  <IconButton
                    onClick={() => handleOpenEditDialog(reminder)}
                    size="small"
                    title="Editar lembrete"
                    sx={{ color: 'primary.main' }}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    onClick={() => handleOpenDeleteDialog(reminder)}
                    size="small"
                    title="Remover lembrete"
                    color="destructive"
                  >
                    <DeleteIcon />
                  </IconButton>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onClose={handleCloseEditDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Editar Lembrete</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            {selectedReminder && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {selectedReminder.auction.title || `Leilão ${selectedReminder.auction.code}`}
              </Typography>
            )}

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControl fullWidth>
                <InputLabel id="edit-channel-label">Canal de notificação</InputLabel>
                <Select
                  labelId="edit-channel-label"
                  value={editChannel}
                  label="Canal de notificação"
                  onChange={(e) => setEditChannel(e.target.value as ReminderChannel)}
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

              <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="pt-br">
                <DateTimePicker
                  label="Data e hora do lembrete"
                  value={editScheduledAt}
                  onChange={(newValue) => setEditScheduledAt(newValue)}
                  timeSteps={{ minutes: 10 }}
                  slotProps={{
                    textField: {
                      fullWidth: true,
                      helperText: 'O lembrete deve ser antes do início do leilão',
                    },
                  }}
                />
              </LocalizationProvider>

              <TextField
                label="Nota (opcional)"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                multiline
                rows={2}
                fullWidth
                slotProps={{ htmlInput: { maxLength: 500 } }}
                helperText={`${editDescription.length}/500 caracteres`}
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditDialog} disabled={actionLoading}>
            Cancelar
          </Button>
          <Button
            onClick={handleSaveEdit}
            variant="contained"
            disabled={actionLoading}
            startIcon={actionLoading ? <CircularProgress size={16} /> : null}
          >
            Salvar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={handleCloseDeleteDialog} maxWidth="xs" fullWidth>
        <DialogTitle>Remover Lembrete</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Typography>
            Tem certeza que deseja remover o lembrete para{' '}
            <strong>
              {selectedReminder?.auction.title || `Leilão ${selectedReminder?.auction.code}`}
            </strong>
            ?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDeleteDialog} disabled={actionLoading}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirmDelete}
            color="destructive"
            variant="contained"
            disabled={actionLoading}
            startIcon={actionLoading ? <CircularProgress size={16} /> : <DeleteIcon />}
          >
            Remover
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
