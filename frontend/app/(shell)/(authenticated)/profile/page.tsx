'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Container,
  Divider,
  MenuItem,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import BadgeIcon from '@mui/icons-material/Badge';
import LockIcon from '@mui/icons-material/Lock';
import { shellContentMinHeight } from '@/app/components/patterns/shell-content';
import { reportClientError } from '@/lib/report-client-error';
import { readApiError, useApiErrorMessage } from '@/lib/api-error';

export default function ProfilePage() {
  const { user, isAuthenticated, loading: authLoading, loadUser } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const t = useTranslations('profile');
  const apiErrorMessage = useApiErrorMessage();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Personal data fields
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [sex, setSex] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
    }
  }, [user]);

  // Load full profile data
  useEffect(() => {
    if (!isAuthenticated) return;
    const loadFullProfile = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/auth/profile/full', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setPhone(data.phone || '');
          setCpf(data.cpf || '');
          setDateOfBirth(data.dateOfBirth ? data.dateOfBirth.split('T')[0] : '');
          setSex(data.sex || '');
          setStreet(data.address?.street || '');
          setCity(data.address?.city || '');
          setState(data.address?.state || '');
          setZipCode(data.address?.zipCode || '');
        }
      } catch (err) {
        reportClientError(err, { where: 'profile page' });
      }
    };
    void loadFullProfile();
  }, [isAuthenticated]);

  const handleSavePersonalData = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setProfileLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/auth/profile/complete', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          phone: phone || undefined,
          cpf: cpf || undefined,
          dateOfBirth: dateOfBirth || undefined,
          sex: sex || undefined,
          address: {
            street: street || undefined,
            city: city || undefined,
            state: state || undefined,
            zipCode: zipCode || undefined,
          },
        }),
      });

      if (!response.ok) {
        throw await readApiError(response);
      }

      setSuccess(t('success.personalData'));
    } catch (err: unknown) {
      setError(apiErrorMessage(err));
    } finally {
      setProfileLoading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, email }),
      });

      if (!response.ok) {
        throw await readApiError(response);
      }

      setSuccess(t('success.profile'));
    } catch (err: unknown) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError(t('errors.passwordMismatch'));
      return;
    }

    if (newPassword.length < 6) {
      setError(t('errors.passwordTooShort'));
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        throw await readApiError(response);
      }

      setSuccess(t('success.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError(t('errors.passwordMismatch'));
      return;
    }

    if (newPassword.length < 6) {
      setError(t('errors.passwordTooShort'));
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword }),
      });

      if (!response.ok) {
        throw await readApiError(response);
      }

      setSuccess(t('success.passwordSet'));
      setNewPassword('');
      setConfirmPassword('');
      await loadUser();
    } catch (err: unknown) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
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
    <>
      {/* #42: the AppShell owns the top bar, navigation and <main>; pt no longer offsets a fixed bar */}
      <Container maxWidth="md" sx={{ pt: 4, pb: 4, flexGrow: 1 }}>
        <Typography variant="h4" sx={{ mb: 1, fontWeight: 700 }}>
          {t('title')}
        </Typography>
        <Typography variant="body1" sx={{ mb: 4, color: 'text.secondary' }}>
          {t('subtitle')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 3 }}>
            {success}
          </Alert>
        )}

        {/* Profile Information */}
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 1,
                  backgroundColor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <PersonIcon sx={{ color: 'primary.contrastText', fontSize: 20 }} />
              </Box>
              <Typography variant="h6">{t('profileInfo.title')}</Typography>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <form onSubmit={handleUpdateProfile}>
              <TextField
                fullWidth
                label={t('profileInfo.name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                margin="normal"
                required
              />
              <TextField
                fullWidth
                label={t('profileInfo.email')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                margin="normal"
                required
                disabled={user?.providers?.includes('google')}
                helperText={
                  user?.providers?.includes('google') ? t('profileInfo.emailLockedForGoogle') : ''
                }
              />
              <Button type="submit" variant="contained" fullWidth disabled={loading} sx={{ mt: 2 }}>
                {loading ? <CircularProgress size={24} /> : t('profileInfo.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Personal Data */}
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 1,
                  backgroundColor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <BadgeIcon sx={{ color: 'primary.contrastText', fontSize: 20 }} />
              </Box>
              <Typography variant="h6">{t('personalData.title')}</Typography>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <form onSubmit={handleSavePersonalData}>
              <TextField
                fullWidth
                label={t('personalData.phone')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                margin="normal"
                placeholder={t('personalData.phonePlaceholder')}
              />
              <TextField
                fullWidth
                label={t('personalData.cpf')}
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                margin="normal"
                placeholder={t('personalData.cpfPlaceholder')}
              />
              <TextField
                fullWidth
                label={t('personalData.dateOfBirth')}
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                margin="normal"
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                fullWidth
                select
                label={t('personalData.sex')}
                value={sex}
                onChange={(e) => setSex(e.target.value)}
                margin="normal"
              >
                <MenuItem value="">{t('personalData.sexOptions.none')}</MenuItem>
                <MenuItem value="male">{t('personalData.sexOptions.male')}</MenuItem>
                <MenuItem value="female">{t('personalData.sexOptions.female')}</MenuItem>
                <MenuItem value="other">{t('personalData.sexOptions.other')}</MenuItem>
              </TextField>

              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1, color: 'text.secondary' }}>
                {t('personalData.address')}
              </Typography>
              <TextField
                fullWidth
                label={t('personalData.street')}
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                margin="normal"
              />
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  fullWidth
                  label={t('personalData.city')}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  margin="normal"
                />
                <TextField
                  fullWidth
                  label={t('personalData.state')}
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  margin="normal"
                  placeholder={t('personalData.statePlaceholder')}
                />
              </Box>
              <TextField
                fullWidth
                label={t('personalData.zipCode')}
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                margin="normal"
                placeholder={t('personalData.zipCodePlaceholder')}
              />
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={profileLoading}
                sx={{ mt: 2 }}
              >
                {profileLoading ? <CircularProgress size={24} /> : t('personalData.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Password Section */}
        {user?.providers?.includes('local') ? (
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: 1,
                    backgroundColor: 'primary.main',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <LockIcon sx={{ color: 'primary.contrastText', fontSize: 20 }} />
                </Box>
                <Typography variant="h6">{t('changePassword.title')}</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <form onSubmit={handleChangePassword}>
                <TextField
                  fullWidth
                  label={t('changePassword.current')}
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  margin="normal"
                  required
                />
                <TextField
                  fullWidth
                  label={t('password.new')}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  margin="normal"
                  required
                />
                <TextField
                  fullWidth
                  label={t('password.confirm')}
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  margin="normal"
                  required
                />
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  disabled={loading}
                  sx={{ mt: 2 }}
                >
                  {loading ? <CircularProgress size={24} /> : t('changePassword.submit')}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: 1,
                    backgroundColor: 'primary.main',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <LockIcon sx={{ color: 'primary.contrastText', fontSize: 20 }} />
                </Box>
                <Typography variant="h6">{t('setPassword.title')}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('setPassword.intro')}
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <form onSubmit={handleSetPassword}>
                <TextField
                  fullWidth
                  label={t('password.new')}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  margin="normal"
                  required
                />
                <TextField
                  fullWidth
                  label={t('password.confirm')}
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  margin="normal"
                  required
                />
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  disabled={loading}
                  sx={{ mt: 2 }}
                >
                  {loading ? <CircularProgress size={24} /> : t('setPassword.submit')}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </Container>
    </>
  );
}
