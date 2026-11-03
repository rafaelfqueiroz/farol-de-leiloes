'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Container,
  Typography,
  Button,
  TextField,
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
  Pagination,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import DateField from '@/app/components/DateField';
import DateText from '@/app/components/patterns/DateText';
import Money from '@/app/components/patterns/Money';
import { useAuth } from '@/app/contexts/AuthContext';
import { TIME_ZONE } from '@/i18n/config';
import { parseMoneyInput } from '@/lib/money';
import { readApiError, useApiErrorMessage } from '@/lib/api-error';
import { pageCount, type Paginated } from '@/lib/pagination';
import { reportClientError } from '@/lib/report-client-error';

// AR-35: the coupons list is paginated; this is how many rows one page shows.
const PAGE_SIZE = 20;

interface Coupon {
  _id: string;
  code: string;
  /** Reais as a money string, e.g. "10.00" (AR-17). */
  discountValue: string;
  validTo: string;
  active: boolean;
  description?: string;
  createdAt: string;
}

export default function AdminCouponsPage() {
  const router = useRouter();
  const { role, loading: authLoading } = useAuth();
  const apiErrorMessage = useApiErrorMessage();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({
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
      const response = await fetch(`/api/coupons?page=${page}&pageSize=${PAGE_SIZE}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data: Paginated<Coupon> = await response.json();
        // the last coupon of the last page was removed or the list shrank: step back
        if (data.items.length === 0 && page > 1) {
          setPage(pageCount(data.total, PAGE_SIZE));
          return;
        }
        setCoupons(data.items);
        setTotal(data.total);
      } else {
        throw await readApiError(response);
      }
    } catch (err) {
      reportClientError(err, { where: 'admin/coupons page' });
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (!authLoading && role !== 'admin') {
      router.push('/');
      return;
    }
    if (!authLoading && role === 'admin') {
      void loadCoupons();
    }
  }, [authLoading, role, router, loadCoupons]);

  const handleCreateCoupon = async () => {
    if (!newCode.trim() || !newDiscountValue || !newValidTo) return;
    // the form field is free text in reais; the API takes a money string with two places
    const discountValue = parseMoneyInput(newDiscountValue);
    if (discountValue === null) {
      setSnackbar({
        open: true,
        message: 'Informe o valor do desconto em reais, com até duas casas decimais',
        severity: 'error',
      });
      return;
    }
    setSaving(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/coupons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: newCode.toUpperCase(),
          discountValue,
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
        void loadCoupons();
      } else {
        throw await readApiError(response);
      }
    } catch (error: unknown) {
      setSnackbar({ open: true, message: apiErrorMessage(error), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleInvalidate = async (couponId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/coupons/${couponId}/invalidate`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        setSnackbar({ open: true, message: 'Cupom invalidado', severity: 'success' });
        void loadCoupons();
      } else {
        throw await readApiError(response);
      }
    } catch (error: unknown) {
      setSnackbar({ open: true, message: apiErrorMessage(error), severity: 'error' });
    }
  };

  const isExpired = (validTo: string) => new Date(validTo) < new Date();

  if (!authLoading && role !== 'admin') return null;

  return (
    <>
      {/* #42: the AppShell owns the top bar, navigation and <main>; pt no longer offsets a fixed bar */}
      <Container maxWidth="lg" sx={{ pt: 4, pb: 4, flexGrow: 1 }}>
        {authLoading || loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
            >
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

            <TableContainer component={Paper} variant="outlined">
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
                      <TableRow key={coupon._id} sx={{ opacity: inactive ? 0.5 : 1 }}>
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
                          <Money value={coupon.discountValue} />
                        </TableCell>
                        <TableCell>
                          <DateText value={coupon.validTo} />
                        </TableCell>
                        <TableCell>
                          {!coupon.active ? (
                            <Chip
                              label="Invalidado"
                              size="small"
                              color="error"
                              variant="outlined"
                            />
                          ) : expired ? (
                            <Chip
                              label="Expirado"
                              size="small"
                              color="warning"
                              variant="outlined"
                            />
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
                              color="destructive"
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

            {total > PAGE_SIZE && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                <Pagination
                  count={pageCount(total, PAGE_SIZE)}
                  page={page}
                  onChange={(_, newPage) => setPage(newPage)}
                  color="primary"
                />
              </Box>
            )}
          </>
        )}
      </Container>

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
          <Box sx={{ mt: 2, mb: 1 }}>
            <DateField
              label="Valido ate"
              value={newValidTo || null}
              onChange={(value) => setNewValidTo(value ?? '')}
              min={format(new TZDate(new Date(), TIME_ZONE), 'yyyy-MM-dd')}
            />
          </Box>
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
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar({ ...snackbar, open: false })}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
