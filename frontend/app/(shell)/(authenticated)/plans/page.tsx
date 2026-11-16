'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  TextField,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Alert,
  Snackbar,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import StarIcon from '@mui/icons-material/Star';
import LockIcon from '@mui/icons-material/Lock';
import Money from '@/app/components/patterns/Money';
import PageHeader from '@/app/components/patterns/PageHeader';
import PageShell from '@/app/components/patterns/PageShell';
import { useAuth } from '@/app/contexts/AuthContext';
import { apiJson } from '@/lib/api-client';
import { useApiErrorMessage } from '@/lib/api-error';
import { formatCount } from '@/lib/numbers';

const SAVED_FILTERS_LIMIT = 10;

type PlanId = 'free' | 'standard' | 'premium';

type PlanFeature =
  | 'manualSearch'
  | 'includesFree'
  | 'includesStandard'
  | 'favorites'
  | 'savedFilters'
  | 'reminders'
  | 'prioritySupport'
  | 'aiSearch'
  | 'customAlerts'
  | 'advancedReports';

interface Plan {
  id: PlanId;
  // AR-17: a decimal string of reais, rendered by <Money>
  price: string;
  features: PlanFeature[];
  highlighted: boolean;
  disabled?: boolean;
}

const plans: Plan[] = [
  {
    id: 'free',
    price: '0.00',
    features: ['manualSearch'],
    highlighted: false,
  },
  {
    id: 'standard',
    price: '49.90',
    features: ['includesFree', 'favorites', 'savedFilters', 'reminders', 'prioritySupport'],
    highlighted: true,
  },
  {
    id: 'premium',
    price: '109.90',
    features: ['includesStandard', 'aiSearch', 'customAlerts', 'advancedReports'],
    highlighted: false,
    disabled: true,
  },
];

export default function PlansPage() {
  const { role, hasSubscription } = useAuth();
  const apiErrorMessage = useApiErrorMessage();
  const t = useTranslations('plans');
  const tPlan = useTranslations('plan');
  const tc = useTranslations('common');
  const [couponCode, setCouponCode] = useState('');
  const [couponValid, setCouponValid] = useState<boolean | null>(null);
  const [couponDiscount, setCouponDiscount] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const handleValidateCoupon = async () => {
    if (!couponCode.trim()) return;
    setValidatingCoupon(true);
    setCouponValid(null);

    try {
      const data = await apiJson<{ discountValue: string }>('/api/coupons/validate', {
        method: 'POST',
        json: { code: couponCode },
      });
      setCouponValid(true);
      setCouponDiscount(data.discountValue);
    } catch (error: unknown) {
      setCouponValid(false);
      setSnackbar({ open: true, message: apiErrorMessage(error), severity: 'error' });
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleSubscribe = async (planId: string) => {
    if (planId === 'free' || planId === 'premium') return;
    setLoading(true);

    try {
      const body: { planId: string; couponCode?: string } = { planId };
      if (couponCode.trim() && couponValid) {
        body.couponCode = couponCode.trim();
      }

      const data = await apiJson<{ url: string }>('/api/payments/create-checkout-session', {
        method: 'POST',
        json: body,
      });
      window.location.assign(data.url);
    } catch (error: unknown) {
      setSnackbar({ open: true, message: apiErrorMessage(error), severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    setCanceling(true);
    try {
      await apiJson('/api/payments/cancel-subscription', { method: 'POST' });
      setSnackbar({
        open: true,
        message: t('cancelSuccess'),
        severity: 'success',
      });
      setCancelDialogOpen(false);
      // Reload user data
      window.location.reload();
    } catch (error: unknown) {
      setSnackbar({ open: true, message: apiErrorMessage(error), severity: 'error' });
    } finally {
      setCanceling(false);
    }
  };

  const getUserPlanId = () => {
    if (role === 'standard' && hasSubscription) return 'standard';
    if (role === 'premium') return 'premium';
    return 'free';
  };

  const currentPlanId = getUserPlanId();

  const showCoupon = currentPlanId !== 'standard';

  return (
    <>
      {/* DS-14: the shell owns <main>; plans need three columns, so they use the app width */}
      <PageShell width="app">
        <PageHeader title={t('title')} summary={t('subtitle')} />

        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
            // room for the "Mais popular" chip that sits on the top edge of its card
            pt: 1,
          }}
        >
          {plans.map((plan) => (
            <Card
              key={plan.id}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                // DESIGN.md §2: the featured plan is one of amber's rare highlights
                border: plan.highlighted ? 2 : 1,
                borderColor: plan.highlighted ? 'secondary.main' : 'divider',
                opacity: plan.disabled ? 0.7 : 1,
              }}
            >
              {plan.highlighted && (
                <Chip
                  label={tPlan('popular')}
                  size="small"
                  icon={<StarIcon />}
                  sx={(theme) => ({
                    position: 'absolute',
                    top: theme.spacing(-1.75),
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: 'secondary.soft',
                    color: 'secondary.ink',
                    border: 1,
                    borderColor: 'secondary.main',
                    '& .MuiChip-icon': { color: 'secondary.ink' },
                  })}
                />
              )}
              <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="h4" component="h2">
                  {tPlan(`names.${plan.id}`)}
                </Typography>
                <Box>
                  <Typography component="span" variant="metric">
                    <Money value={plan.price} />
                  </Typography>
                  <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>
                    {tPlan('period')}
                  </Typography>
                </Box>

                <List dense disablePadding sx={{ flexGrow: 1 }}>
                  {plan.features.map((feature, idx) => (
                    <ListItem key={idx} disableGutters sx={{ py: 0.5 }}>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        {plan.disabled ? (
                          <LockIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                        ) : (
                          <CheckIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          feature === 'includesFree' || feature === 'includesStandard'
                            ? t(`features.${feature}`)
                            : tPlan(`features.${feature}`, {
                                limit: formatCount(SAVED_FILTERS_LIMIT),
                              })
                        }
                        primaryTypographyProps={{ variant: 'body2' }}
                      />
                    </ListItem>
                  ))}
                </List>

                {currentPlanId === plan.id ? (
                  <Box>
                    <Button variant="outlined" fullWidth disabled sx={{ mb: 1 }}>
                      {t('currentPlan')}
                    </Button>
                    {plan.id === 'standard' && hasSubscription && (
                      <Button
                        variant="text"
                        color="destructive"
                        fullWidth
                        size="small"
                        onClick={() => setCancelDialogOpen(true)}
                      >
                        {t('cancelSubscription')}
                      </Button>
                    )}
                  </Box>
                ) : (
                  <Button
                    variant="contained"
                    fullWidth
                    disabled={plan.disabled || loading || plan.id === 'free'}
                    onClick={() => handleSubscribe(plan.id)}
                  >
                    {loading && plan.id === 'standard' ? (
                      <CircularProgress size={24} color="inherit" />
                    ) : plan.disabled ? (
                      tPlan('comingSoon')
                    ) : plan.id === 'free' ? (
                      tPlan('names.free')
                    ) : (
                      t('subscribe', { name: tPlan(`names.${plan.id}`) })
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </Box>

        {showCoupon && (
          <Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                size="small"
                placeholder={t('coupon.placeholder')}
                value={couponCode}
                onChange={(e) => {
                  setCouponCode(e.target.value.toUpperCase());
                  setCouponValid(null);
                  setCouponDiscount(null);
                }}
                sx={(theme) => ({ flex: 1, maxWidth: theme.spacing(32.5) })}
              />
              <Button
                variant="outlined"
                size="small"
                onClick={handleValidateCoupon}
                disabled={validatingCoupon || !couponCode.trim()}
              >
                {validatingCoupon ? <CircularProgress size={20} /> : t('coupon.apply')}
              </Button>
            </Box>
            {couponValid === true && couponDiscount && (
              <Alert severity="success" sx={{ mt: 1 }}>
                {t.rich('coupon.applied', {
                  discount: () => <Money value={couponDiscount} />,
                })}
              </Alert>
            )}
          </Box>
        )}
      </PageShell>

      <Dialog open={cancelDialogOpen} onClose={() => setCancelDialogOpen(false)}>
        <DialogTitle>{t('cancelSubscription')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('cancelDialog.body')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelDialogOpen(false)}>{tc('back')}</Button>
          <Button onClick={handleCancelSubscription} color="destructive" disabled={canceling}>
            {canceling ? <CircularProgress size={20} /> : t('cancelDialog.confirm')}
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
