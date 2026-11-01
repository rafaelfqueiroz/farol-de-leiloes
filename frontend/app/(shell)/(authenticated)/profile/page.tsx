'use client';

import { useState, useEffect } from 'react';
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

export default function ProfilePage() {
  const { user, isAuthenticated, loading: authLoading, loadUser } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
        console.error('Error loading full profile:', err);
      }
    };
    loadFullProfile();
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
        const data = await response.json();
        throw new Error(data.message || 'Failed to save personal data');
      }

      setSuccess('Dados pessoais salvos com sucesso!');
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar dados pessoais');
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
        const data = await response.json();
        throw new Error(data.message || 'Failed to update profile');
      }

      setSuccess('Perfil atualizado com sucesso!');
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar perfil');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (newPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
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
        const data = await response.json();
        throw new Error(data.message || 'Failed to change password');
      }

      setSuccess('Senha alterada com sucesso!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.message || 'Erro ao alterar senha');
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (newPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
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
        const data = await response.json();
        throw new Error(data.message || 'Failed to set password');
      }

      setSuccess('Senha definida com sucesso! Agora você pode entrar com email e senha.');
      setNewPassword('');
      setConfirmPassword('');
      await loadUser();
    } catch (err: any) {
      setError(err.message || 'Erro ao definir senha');
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
          Meu Perfil
        </Typography>
        <Typography variant="body1" sx={{ mb: 4, color: 'text.secondary' }}>
          Gerencie suas informações pessoais e segurança
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
              <Typography variant="h6">Informações do Perfil</Typography>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <form onSubmit={handleUpdateProfile}>
              <TextField
                fullWidth
                label="Nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                margin="normal"
                required
              />
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                margin="normal"
                required
                disabled={user?.providers?.includes('google')}
                helperText={
                  user?.providers?.includes('google')
                    ? 'Email não pode ser alterado para contas Google'
                    : ''
                }
              />
              <Button type="submit" variant="contained" fullWidth disabled={loading} sx={{ mt: 2 }}>
                {loading ? <CircularProgress size={24} /> : 'Atualizar Perfil'}
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
              <Typography variant="h6">Dados Pessoais</Typography>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <form onSubmit={handleSavePersonalData}>
              <TextField
                fullWidth
                label="Telefone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                margin="normal"
                placeholder="(00) 00000-0000"
              />
              <TextField
                fullWidth
                label="CPF"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                margin="normal"
                placeholder="000.000.000-00"
              />
              <TextField
                fullWidth
                label="Data de Nascimento"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                margin="normal"
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                fullWidth
                select
                label="Sexo"
                value={sex}
                onChange={(e) => setSex(e.target.value)}
                margin="normal"
              >
                <MenuItem value="">Selecione</MenuItem>
                <MenuItem value="male">Masculino</MenuItem>
                <MenuItem value="female">Feminino</MenuItem>
                <MenuItem value="other">Outro</MenuItem>
              </TextField>

              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1, color: 'text.secondary' }}>
                Endereço
              </Typography>
              <TextField
                fullWidth
                label="Rua"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                margin="normal"
              />
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  fullWidth
                  label="Cidade"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  margin="normal"
                />
                <TextField
                  fullWidth
                  label="Estado"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  margin="normal"
                  placeholder="UF"
                />
              </Box>
              <TextField
                fullWidth
                label="CEP"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                margin="normal"
                placeholder="00000-000"
              />
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={profileLoading}
                sx={{ mt: 2 }}
              >
                {profileLoading ? <CircularProgress size={24} /> : 'Salvar Dados Pessoais'}
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
                <Typography variant="h6">Alterar Senha</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <form onSubmit={handleChangePassword}>
                <TextField
                  fullWidth
                  label="Senha Atual"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  margin="normal"
                  required
                />
                <TextField
                  fullWidth
                  label="Nova Senha"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  margin="normal"
                  required
                />
                <TextField
                  fullWidth
                  label="Confirmar Nova Senha"
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
                  {loading ? <CircularProgress size={24} /> : 'Alterar Senha'}
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
                <Typography variant="h6">Definir Senha</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Você entrou com o Google. Defina uma senha para também poder entrar com email e
                senha.
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <form onSubmit={handleSetPassword}>
                <TextField
                  fullWidth
                  label="Nova Senha"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  margin="normal"
                  required
                />
                <TextField
                  fullWidth
                  label="Confirmar Nova Senha"
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
                  {loading ? <CircularProgress size={24} /> : 'Definir Senha'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </Container>
    </>
  );
}
