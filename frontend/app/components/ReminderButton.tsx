'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
import { subHours } from 'date-fns';
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import DeleteIcon from '@mui/icons-material/Delete';
import { useReminders, ReminderChannel } from '../contexts/RemindersContext';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useApiErrorMessage } from '@/lib/api-error';
import { toUtcInstant, tryParseInstant } from '@/lib/dates';
import { formatCount } from '@/lib/numbers';
import DateField from './DateField';
import DateText from './patterns/DateText';

const NOTE_MAX_LENGTH = 500;

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
  const t = useTranslations('reminderButton');
  // the form wording is shared with the reminders page: one wording per concept (DS-28)
  const tr = useTranslations('reminders');
  const tc = useTranslations('common');

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<ReminderChannel>('EMAIL');
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [description, setDescription] = useState('');

  const hasReminder = hasReminderForAuction(auctionCode);
  const existingReminder = getReminderForAuction(auctionCode);

  const isPremium = role === 'standard' || role === 'premium' || role === 'admin';

  const channelOptionLabel = (option: ReminderChannel) =>
    isPremium
      ? tr(`channel.${option}`)
      : tr('channelRestricted', { channel: tr(`channel.${option}`) });

  const handleClick = () => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    setOpen(true);
    setError(null);

    if (!hasReminder) {
      // AR-22/AR-23: reopening starts a fresh draft from the current auction instant.
      const start = auctionDate ? tryParseInstant(auctionDate) : null;
      setScheduledAt(start ? toUtcInstant(subHours(start, 1)) : null);
      setChannel('EMAIL');
      setDescription('');
    }
  };

  const handleClose = () => {
    setOpen(false);
    setError(null);
  };

  const handleCreate = async () => {
    if (!scheduledAt || !tryParseInstant(scheduledAt)) {
      setError(tr('form.scheduledAtRequired'));
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
        title={hasReminder ? t('tooltip.manage') : t('tooltip.create')}
      >
        {hasReminder ? <NotificationsActiveIcon /> : <NotificationsIcon />}
      </IconButton>

      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{hasReminder ? t('dialogTitle.manage') : t('dialogTitle.create')}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {auctionTitle || tr('auctionFallbackTitle', { code: auctionCode })}
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {hasReminder && existingReminder ? (
              <Box sx={{ mb: 2 }}>
                <Alert severity="info" sx={{ mb: 2 }}>
                  {t.rich('scheduled', {
                    date: () => <DateText value={existingReminder.scheduledAt} withTime />,
                    channel: tr(`channel.${existingReminder.channel}`),
                  })}
                </Alert>
                {existingReminder.description && (
                  <Typography variant="body2" color="text.secondary">
                    {t('note', { text: existingReminder.description })}
                  </Typography>
                )}
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <FormControl fullWidth>
                  <InputLabel id="channel-label">{tr('form.channel')}</InputLabel>
                  <Select
                    labelId="channel-label"
                    value={channel}
                    label={tr('form.channel')}
                    onChange={(e) => setChannel(e.target.value as ReminderChannel)}
                  >
                    <MenuItem value="EMAIL">{tr('channel.EMAIL')}</MenuItem>
                    <MenuItem value="SMS" disabled={!isPremium}>
                      {channelOptionLabel('SMS')}
                    </MenuItem>
                    <MenuItem value="WHATSAPP" disabled={!isPremium}>
                      {channelOptionLabel('WHATSAPP')}
                    </MenuItem>
                  </Select>
                </FormControl>

                <DateField
                  type="datetime"
                  label={tr('form.scheduledAt')}
                  value={scheduledAt}
                  onChange={setScheduledAt}
                  minuteStep={10}
                  helperText={tr('form.scheduledAtHelper')}
                />

                <TextField
                  label={tr('form.note')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  multiline
                  rows={2}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: NOTE_MAX_LENGTH } }}
                  helperText={tr('form.noteCounter', {
                    count: formatCount(description.length),
                    max: formatCount(NOTE_MAX_LENGTH),
                  })}
                />
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={loading}>
            {tc('cancel')}
          </Button>
          {hasReminder ? (
            <Button
              onClick={handleDelete}
              color="destructive"
              startIcon={loading ? <CircularProgress size={16} /> : <DeleteIcon />}
              disabled={loading}
            >
              {t('remove')}
            </Button>
          ) : (
            <Button
              onClick={handleCreate}
              variant="contained"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} /> : null}
            >
              {t('create')}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
