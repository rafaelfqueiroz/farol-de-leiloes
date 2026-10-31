'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Container,
  Typography,
  Button,
  TextField,
  ThemeProvider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Snackbar,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import Sidebar from '../../components/Sidebar';
import TopBar from '../../components/TopBar';
import RequireAuthentication from '../../components/RequireAuthentication';
import { useAuth } from '../../contexts/AuthContext';
import theme from '../../legacyTheme';

interface Coupon {
  _id: string;
  code: string;
  discountValue: number;
  validTo: string;
  active: boolean;
  description?: string;
  createdAt: string;
}

export default function AdminCouponsPage() {
  const router = useRouter();
  const { user, role, loading: authLoading } = useAuth();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // New coupon form state
  const [newCode, setNewCode] = useState('');
  const [newDiscountValue, setNewDiscountValue] = useState('');
  const [newValidTo, setNewValidTo] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const loadCoupons = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/coupons', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setCoupons(data);
      }
    } catch (err) {
      console.error('Error loading coupons:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && role !== 'admin') {
      router.push('/');
      return;
    }
    if (!authLoading && role === 'admin') {
      loadCoupons();
    }
  }, [authLoading, role, router, loadCoupons]);

  const handleCreateCoupon = async () => {
    if (!newCode.trim() || !newDiscountValue || !newValidTo) return;
    setSaving(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/coupons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: newCode.toUpperCase(),
          discountValue: Math.round(parseFloat(newDiscountValue) * 100), // Convert BRL to cents
          validTo: newValidTo,
          description: newDescription || undefined,
        }),
      });

      if (response.ok) {
        setSnackbar({ open: true, message: 'Cupom criado com sucesso', severity: 'success' });
        setDialogOpen(false);
        setNewCode('');
        setNewDiscountValue('');
        setNewValidTo('');
        setNewDescription('');
        loadCoupons();
      } else {
        const error = await response.json();
        setSnackbar({ open: true, message: error.message || 'Erro ao criar cupom', severity: 'error' });
      }
    } catch {
      setSnackbar({ open: true, message: 'Erro ao criar cupom', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleInvalidate = async (couponId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/coupons/${couponId}/invalidate`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (response.ok) {
        setSnackbar({ open: true, message: 'Cupom invalidado', severity: 'success' });
        loadCoupons();
      } else {
        const error = await response.json();
        setSnackbar({ open: true, message: error.message || 'Erro ao invalidar cupom', severity: 'error' });
      }
    } catch {
      setSnackbar({ open: true, message: 'Erro ao invalidar cupom', severity: 'error' });
    }
  };

  const isExpired = (validTo: string) => new Date(validTo) < new Date();

  if (!authLoading && role !== 'admin') return null;

  return (
    <ThemeProvider theme={theme}>
      <RequireAuthentication>
      <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: '#FFFFFF' }}>
        <Sidebar activeView="admin" />
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          <TopBar />
          <Container maxWidth="lg" sx={{ pt: 12, pb: 4, flexGrow: 1 }}>
            {authLoading || loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                  <Typography variant="h4" sx={{ fontWeight: 700 }}>
                    Gerenciar Cupons
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => setDialogOpen(true)}
                  >
                    Novo Cupom
                  </Button>
                </Box>

                <TableContainer component={Paper}>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Codigo</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Desconto</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Valido ate</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Descricao</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Acoes</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {coupons.map((coupon) => {
                        const expired = isExpired(coupon.validTo);
                        const inactive = !coupon.active || expired;
                        return (
                          <TableRow
                            key={coupon._id}
                            sx={{ opacity: inactive ? 0.5 : 1 }}
                          >
                            <TableCell>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 700,
                                  fontFamily: 'monospace',
                                  textDecoration: inactive ? 'line-through' : 'none',
                                }}
                              >
                                {coupon.code}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              R$ {(coupon.discountValue / 100).toFixed(2).replace('.', ',')}
                            </TableCell>
                            <TableCell>
                              {new Date(coupon.validTo).toLocaleDateString('pt-BR')}
                            </TableCell>
                            <TableCell>
                              {!coupon.active ? (
                                <Chip label="Invalidado" size="small" color="error" variant="outlined" />
                              ) : expired ? (
                                <Chip label="Expirado" size="small" color="warning" variant="outlined" />
                              ) : (
                                <Chip label="Ativo" size="small" color="success" variant="outlined" />
                              )}
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" color="text.secondary">
                                {coupon.description || '-'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              {coupon.active && !expired && (
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() => handleInvalidate(coupon._id)}
                                >
                                  Invalidar
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {coupons.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} align="center">
                            <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                              Nenhum cupom cadastrado
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </Container>
        </Box>
      </Box>

      {/* Create Coupon Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Novo Cupom</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Codigo do cupom"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.toUpperCase())}
            margin="normal"
            placeholder="EX: DESCONTO10"
          />
          <TextField
            fullWidth
            label="Valor do desconto (R$)"
            type="number"
            value={newDiscountValue}
            onChange={(e) => setNewDiscountValue(e.target.value)}
            margin="normal"
            placeholder="10.00"
            slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
          />
          <TextField
            fullWidth
            label="Valido ate"
            type="date"
            value={newValidTo}
            onChange={(e) => setNewValidTo(e.target.value)}
            margin="normal"
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: new Date().toISOString().split('T')[0] } }}
          />
          <TextField
            fullWidth
            label="Descricao (opcional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            margin="normal"
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={handleCreateCoupon}
            variant="contained"
            disabled={saving || !newCode.trim() || !newDiscountValue || !newValidTo}
          >
            {saving ? <CircularProgress size={20} /> : 'Criar Cupom'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
      </RequireAuthentication>
    </ThemeProvider>
  );
}
