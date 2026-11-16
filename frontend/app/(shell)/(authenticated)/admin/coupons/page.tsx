'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Box,
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
import PageHeader from '@/app/components/patterns/PageHeader';
import PageShell from '@/app/components/patterns/PageShell';
import { useAuth } from '@/app/contexts/AuthContext';
import { TIME_ZONE } from '@/i18n/config';
import { parseMoneyInput } from '@/lib/money';
import { apiJson } from '@/lib/api-client';
import { useApiErrorMessage } from '@/lib/api-error';
import { pageCount, type Paginated } from '@/lib/pagination';
import { reportClientError } from '@/lib/report-client-error';

// AR-35: the coupons list is paginated; this is how many rows one page shows.
const PAGE_SIZE = 20;

// DS-11: a table header is the subtitle2 variant, not a bolder body2
const headCellSx = { typography: 'subtitle2' } as const;

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
  // SPEC-002 BR-002-23: the admin capability, never the plan tier. UX only: the API refuses a
  // non-admin on its own (AR-51).
  const { isAdmin, loading: authLoading } = useAuth();
  const t = useTranslations('adminCoupons');
  const tCommon = useTranslations('common');
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
      const data = await apiJson<Paginated<Coupon>>(
        `/api/coupons?page=${page}&pageSize=${PAGE_SIZE}`,
      );
      // the last coupon of the last page was removed or the list shrank: step back
      if (data.items.length === 0 && page > 1) {
        setPage(pageCount(data.total, PAGE_SIZE));
        return;
      }
      setCoupons(data.items);
      setTotal(data.total);
    } catch (err) {
      reportClientError(err, { where: 'admin/coupons page' });
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/');
      return;
    }
    if (!authLoading && isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches the page from the API (an external system); loadCoupons writes state only once the request settles
      void loadCoupons();
    }
  }, [authLoading, isAdmin, router, loadCoupons]);

  const handleCreateCoupon = async () => {
    if (!newCode.trim() || !newDiscountValue || !newValidTo) return;
    // the form field is free text in reais; the API takes a money string with two places
    const discountValue = parseMoneyInput(newDiscountValue);
    if (discountValue === null) {
      setSnackbar({
        open: true,
        message: t('errors.invalidDiscount'),
        severity: 'error',
      });
      return;
    }
    setSaving(true);

    try {
      await apiJson('/api/coupons', {
        method: 'POST',
        json: {
          code: newCode.toUpperCase(),
          discountValue,
          validTo: newValidTo,
          description: newDescription || undefined,
        },
      });
      setSnackbar({ open: true, message: t('snackbar.created'), severity: 'success' });
      setDialogOpen(false);
      setNewCode('');
      setNewDiscountValue('');
      setNewValidTo('');
      setNewDescription('');
      void loadCoupons();
    } catch (error: unknown) {
      setSnackbar({ open: true, message: apiErrorMessage(error), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleInvalidate = async (couponId: string) => {
    try {
      await apiJson(`/api/coupons/${couponId}/invalidate`, { method: 'PATCH' });
      setSnackbar({ open: true, message: t('snackbar.invalidated'), severity: 'success' });
      void loadCoupons();
    } catch (error: unknown) {
      setSnackbar({ open: true, message: apiErrorMessage(error), severity: 'error' });
    }
  };

  const isExpired = (validTo: string) => new Date(validTo) < new Date();

  if (!authLoading && !isAdmin) return null;

  return (
    <>
      {/* DS-14: the shell owns <main>; a list page uses the app width */}
      <PageShell width="app">
        <PageHeader
          title={t('title')}
          actions={
            authLoading || loading ? undefined : (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setDialogOpen(true)}
              >
                {t('new')}
              </Button>
            )
          }
        />
        {authLoading || loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <TableContainer
              component={Paper}
              variant="outlined"
              // BR-003-16, WCAG 2.1.1: a table that scrolls sideways at 360 px (DS-13) is
              // scrolled by keyboard only if its container is focusable, so it is a named region.
              tabIndex={0}
              role="region"
              aria-label={t('title')}
            >
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={headCellSx}>{t('columns.code')}</TableCell>
                    <TableCell sx={headCellSx}>{t('columns.discount')}</TableCell>
                    <TableCell sx={headCellSx}>{t('columns.validTo')}</TableCell>
                    <TableCell sx={headCellSx}>{t('columns.status')}</TableCell>
                    <TableCell sx={headCellSx}>{t('columns.description')}</TableCell>
                    <TableCell sx={headCellSx}>{t('columns.actions')}</TableCell>
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
                            variant="subtitle2"
                            component="span"
                            sx={{
                              // DS-12: Inter's tabular numerals stand in for the old monospace code
                              fontVariantNumeric: 'tabular-nums',
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
                              label={t('status.invalidated')}
                              size="small"
                              color="error"
                              variant="outlined"
                            />
                          ) : expired ? (
                            <Chip
                              label={t('status.expired')}
                              size="small"
                              color="warning"
                              variant="outlined"
                            />
                          ) : (
                            <Chip
                              label={t('status.active')}
                              size="small"
                              color="success"
                              variant="outlined"
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {coupon.description || t('noDescription')}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {coupon.active && !expired && (
                            <Button
                              size="small"
                              color="destructive"
                              onClick={() => handleInvalidate(coupon._id)}
                            >
                              {t('invalidate')}
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
                          {t('empty')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            {total > PAGE_SIZE && (
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
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
      </PageShell>

      {/* Create Coupon Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('new')}</DialogTitle>
        <DialogContent>
          <TextField
            // eslint-disable-next-line jsx-a11y/no-autofocus -- focus moves to the first field when this modal dialog opens (DS-21)
            autoFocus
            fullWidth
            label={t('form.code')}
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.toUpperCase())}
            margin="normal"
            placeholder={t('form.codePlaceholder')}
          />
          <TextField
            fullWidth
            label={t('form.discountValue')}
            type="number"
            value={newDiscountValue}
            onChange={(e) => setNewDiscountValue(e.target.value)}
            margin="normal"
            placeholder={t('form.discountValuePlaceholder')}
            slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
          />
          <Box sx={{ mt: 2, mb: 1 }}>
            <DateField
              label={t('form.validTo')}
              value={newValidTo || null}
              onChange={(value) => setNewValidTo(value ?? '')}
              min={format(new TZDate(new Date(), TIME_ZONE), 'yyyy-MM-dd')}
            />
          </Box>
          <TextField
            fullWidth
            label={t('form.description')}
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            margin="normal"
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button
            onClick={handleCreateCoupon}
            variant="contained"
            disabled={saving || !newCode.trim() || !newDiscountValue || !newValidTo}
          >
            {saving ? <CircularProgress size={20} /> : t('form.submit')}
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
