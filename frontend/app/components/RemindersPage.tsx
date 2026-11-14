'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import ErrorState from '@/app/components/patterns/ErrorState';
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
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import NotificationsIcon from '@mui/icons-material/Notifications';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { useReminders, Reminder, ReminderChannel } from '../contexts/RemindersContext';
import { useAuth } from '../contexts/AuthContext';
import { useApiErrorMessage } from '@/lib/api-error';
import { toUtcInstant, tryParseInstant } from '@/lib/dates';
import { formatCount } from '@/lib/numbers';
import DateField from './DateField';
import DateText from './patterns/DateText';

const CHANNEL_ICONS: Record<ReminderChannel, React.ReactElement> = {
  EMAIL: <EmailIcon fontSize="small" />,
  SMS: <SmsIcon fontSize="small" />,
  WHATSAPP: <WhatsAppIcon fontSize="small" />,
};

const NOTE_MAX_LENGTH = 500;

const bold = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

export default function RemindersPage() {
  const router = useRouter();
  const { reminders, loading, loadFailed, deleteReminder, updateReminder, refreshReminders } =
    useReminders();
  const t = useTranslations('reminders');
  const tc = useTranslations('common');
  const tLoadFailed = useTranslations('loadFailed.reminders');
  const { role } = useAuth();
  const apiErrorMessage = useApiErrorMessage();

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedReminder, setSelectedReminder] = useState<Reminder | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit form state
  const [editChannel, setEditChannel] = useState<ReminderChannel>('EMAIL');
  const [editScheduledAt, setEditScheduledAt] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');

  const auctionTitle = (auction: Reminder['auction']) =>
    auction.title || t('auctionFallbackTitle', { code: auction.code });

  const formatAddress = (auction: Reminder['auction']): string => {
    const parts = [auction.city, auction.state].filter(Boolean);
    return parts.join(', ') || t('locationMissing');
  };

  const channelOptionLabel = (channel: ReminderChannel, restricted: boolean) =>
    restricted
      ? t('channelRestricted', { channel: t(`channel.${channel}`) })
      : t(`channel.${channel}`);

  const isPremium = role === 'standard' || role === 'premium' || role === 'admin';

  // Filter only pending reminders and sort by scheduledAt
  const upcomingReminders = reminders
    .filter((r) => r.status === 'PENDING')
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const handleOpenEditDialog = (reminder: Reminder) => {
    setSelectedReminder(reminder);
    setEditChannel(reminder.channel);
    const instant = tryParseInstant(reminder.scheduledAt);
    setEditScheduledAt(instant ? toUtcInstant(instant) : null);
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
    if (!selectedReminder || !editScheduledAt || !tryParseInstant(editScheduledAt)) {
      setError(t('form.scheduledAtRequired'));
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const success = await updateReminder(selectedReminder._id, {
        channel: editChannel,
        scheduledAt: editScheduledAt,
        description: editDescription || undefined,
      });

      if (success) {
        handleCloseEditDialog();
      } else {
        setError(apiErrorMessage(null));
      }
    } catch (err: unknown) {
      setError(apiErrorMessage(err));
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
        setError(apiErrorMessage(null));
      }
    } catch (err: unknown) {
      setError(apiErrorMessage(err));
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
          {t('title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('subtitle')}
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
        {t('title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('subtitle')}
      </Typography>

      {loadFailed && (
        <ErrorState
          title={tLoadFailed('title')}
          message={tLoadFailed('message')}
          onRetry={() => void refreshReminders()}
        />
      )}

      {upcomingReminders.length === 0 ? (
        loadFailed ? null : (
          <Card sx={{ textAlign: 'center', py: 6 }}>
            <CardContent>
              <NotificationsIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
                {t('empty.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {t('empty.description')}
              </Typography>
              <Button variant="contained" onClick={() => router.push('/search')}>
                {t('empty.action')}
              </Button>
            </CardContent>
          </Card>
        )
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {upcomingReminders.map((reminder) => (
            <Card key={reminder._id}>
              <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
                      {auctionTitle(reminder.auction)}
                    </Typography>
                    <Chip
                      icon={CHANNEL_ICONS[reminder.channel]}
                      label={t(`channel.${reminder.channel}`)}
                      size="small"
                      variant="outlined"
                    />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {formatAddress(reminder.auction)}
                  </Typography>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Typography variant="body2">
                      {t.rich('scheduledFor', {
                        strong: bold,
                        date: () => <DateText value={reminder.scheduledAt} withTime />,
                      })}
                    </Typography>
                    {reminder.description && (
                      <Typography variant="body2" color="text.secondary">
                        {t.rich('note', { strong: bold, text: reminder.description })}
                      </Typography>
                    )}
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <IconButton
                    onClick={() => handleNavigateToAuction(reminder.auction.code)}
                    size="small"
                    title={t('actions.viewAuction')}
                    sx={{ color: 'info.main' }}
                  >
                    <OpenInNewIcon />
                  </IconButton>
                  <IconButton
                    onClick={() => handleOpenEditDialog(reminder)}
                    size="small"
                    title={t('actions.edit')}
                    sx={{ color: 'primary.main' }}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    onClick={() => handleOpenDeleteDialog(reminder)}
                    size="small"
                    title={t('actions.remove')}
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
        <DialogTitle>{t('editDialog.title')}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            {selectedReminder && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {auctionTitle(selectedReminder.auction)}
              </Typography>
            )}

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControl fullWidth>
                <InputLabel id="edit-channel-label">{t('form.channel')}</InputLabel>
                <Select
                  labelId="edit-channel-label"
                  value={editChannel}
                  label={t('form.channel')}
                  onChange={(e) => setEditChannel(e.target.value as ReminderChannel)}
                >
                  <MenuItem value="EMAIL">{t('channel.EMAIL')}</MenuItem>
                  <MenuItem value="SMS" disabled={!isPremium}>
                    {channelOptionLabel('SMS', !isPremium)}
                  </MenuItem>
                  <MenuItem value="WHATSAPP" disabled={!isPremium}>
                    {channelOptionLabel('WHATSAPP', !isPremium)}
                  </MenuItem>
                </Select>
              </FormControl>

              <DateField
                type="datetime"
                label={t('form.scheduledAt')}
                value={editScheduledAt}
                onChange={setEditScheduledAt}
                minuteStep={10}
                helperText={t('form.scheduledAtHelper')}
              />

              <TextField
                label={t('form.note')}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                multiline
                rows={2}
                fullWidth
                slotProps={{ htmlInput: { maxLength: NOTE_MAX_LENGTH } }}
                helperText={t('form.noteCounter', {
                  count: formatCount(editDescription.length),
                  max: formatCount(NOTE_MAX_LENGTH),
                })}
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditDialog} disabled={actionLoading}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={handleSaveEdit}
            variant="contained"
            disabled={actionLoading}
            startIcon={actionLoading ? <CircularProgress size={16} /> : null}
          >
            {tc('save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={handleCloseDeleteDialog} maxWidth="xs" fullWidth>
        <DialogTitle>{t('deleteDialog.title')}</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Typography>
            {t.rich('deleteDialog.confirm', {
              strong: bold,
              auction: selectedReminder ? auctionTitle(selectedReminder.auction) : '',
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDeleteDialog} disabled={actionLoading}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={handleConfirmDelete}
            color="destructive"
            variant="contained"
            disabled={actionLoading}
            startIcon={actionLoading ? <CircularProgress size={16} /> : <DeleteIcon />}
          >
            {t('deleteDialog.submit')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
