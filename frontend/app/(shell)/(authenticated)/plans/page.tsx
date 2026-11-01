'use client';

import { useState } from 'react';
import {
  Box,
  Container,
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
import { useAuth } from '@/app/contexts/AuthContext';

interface Plan {
  id: string;
  name: string;
  price: string;
  period: string;
  features: string[];
  highlighted: boolean;
  disabled?: boolean;
}

const plans: Plan[] = [
  {
    id: 'free',
    name: 'Gratuito',
    price: 'R$ 0',
    period: '/mes',
    features: ['Busca manual por filtros'],
    highlighted: false,
  },
  {
    id: 'standard',
    name: 'Standard',
    price: 'R$ 49,90',
    period: '/mes',
    features: [
      'Tudo do plano Gratuito',
      'Favoritos',
      'Filtros salvos (ate 10)',
      'Lembretes',
      'Suporte prioritario',
    ],
    highlighted: true,
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 'R$ 109,90',
    period: '/mes',
    features: [
      'Tudo do plano Standard',
      'Busca por IA',
      'Alertas personalizados',
      'Relatorios avancados',
    ],
    highlighted: false,
    disabled: true,
  },
];

export default function PlansPage() {
  const { role, hasSubscription } = useAuth();
  const [couponCode, setCouponCode] = useState('');
  const [couponValid, setCouponValid] = useState<boolean | null>(null);
  const [couponDiscount, setCouponDiscount] = useState<number | null>(null);
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
      const token = localStorage.getItem('token');
      const response = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: couponCode }),
      });

      if (response.ok) {
        const data = await response.json();
        setCouponValid(true);
        setCouponDiscount(data.discountValue);
      } else {
        const error = await response.json();
        setCouponValid(false);
        setSnackbar({ open: true, message: error.message || 'Cupom invalido', severity: 'error' });
      }
    } catch {
      setCouponValid(false);
      setSnackbar({ open: true, message: 'Erro ao validar cupom', severity: 'error' });
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleSubscribe = async (planId: string) => {
    if (planId === 'free' || planId === 'premium') return;
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const body: any = { planId };
      if (couponCode.trim() && couponValid) {
        body.couponCode = couponCode.trim();
      }

      const response = await fetch('/api/payments/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        window.location.href = data.url;
      } else {
        const error = await response.json();
        setSnackbar({
          open: true,
          message: error.message || 'Erro ao criar sessao de pagamento',
          severity: 'error',
        });
      }
    } catch {
      setSnackbar({ open: true, message: 'Erro ao processar pagamento', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    setCanceling(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/payments/cancel-subscription', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        setSnackbar({
          open: true,
          message: 'Assinatura cancelada com sucesso',
          severity: 'success',
        });
        setCancelDialogOpen(false);
        // Reload user data
        window.location.reload();
      } else {
        const error = await response.json();
        setSnackbar({
          open: true,
          message: error.message || 'Erro ao cancelar assinatura',
          severity: 'error',
        });
      }
    } catch {
      setSnackbar({ open: true, message: 'Erro ao cancelar assinatura', severity: 'error' });
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

  return (
    <>
      {/* #42: the AppShell owns the top bar, navigation and <main>; pt no longer offsets a fixed bar */}
      <Container maxWidth="lg" sx={{ pt: 4, pb: 4, flexGrow: 1 }}>
        <Typography variant="h4" sx={{ mb: 1, fontWeight: 700 }}>
          Planos
        </Typography>
        <Typography variant="body1" sx={{ mb: 4, color: 'text.secondary' }}>
          Escolha o plano ideal para suas necessidades
        </Typography>

        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
          {plans.map((plan) => (
            <Card
              key={plan.id}
              sx={{
                width: 320,
                position: 'relative',
                // DESIGN.md §2: the featured plan is one of amber's rare highlights
                border: plan.highlighted ? 2 : 1,
                borderColor: plan.highlighted ? 'secondary.main' : 'divider',
                opacity: plan.disabled ? 0.6 : 1,
              }}
            >
              {plan.highlighted && (
                <Chip
                  label="Mais popular"
                  size="small"
                  icon={<StarIcon />}
                  sx={{
                    position: 'absolute',
                    top: -12,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: 'secondary.main',
                    color: 'secondary.contrastText',
                    '& .MuiChip-icon': { color: 'secondary.contrastText' },
                  }}
                />
              )}
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
                  {plan.name}
                </Typography>
                <Box sx={{ mb: 3 }}>
                  <Typography component="span" variant="h4" sx={{ fontWeight: 700 }}>
                    {plan.price}
                  </Typography>
                  {plan.period && (
                    <Typography component="span" variant="body1" sx={{ color: 'text.secondary' }}>
                      {plan.period}
                    </Typography>
                  )}
                </Box>

                <List dense sx={{ mb: 3 }}>
                  {plan.features.map((feature, idx) => (
                    <ListItem key={idx} disableGutters sx={{ py: 0.5 }}>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        {plan.disabled ? (
                          <LockIcon sx={{ fontSize: 18 }} />
                        ) : (
                          <CheckIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        primary={feature}
                        primaryTypographyProps={{ variant: 'body2' }}
                      />
                    </ListItem>
                  ))}
                </List>

                {plan.id === 'standard' && currentPlanId !== 'standard' && (
                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <TextField
                        size="small"
                        placeholder="Cupom de desconto"
                        value={couponCode}
                        onChange={(e) => {
                          setCouponCode(e.target.value.toUpperCase());
                          setCouponValid(null);
                          setCouponDiscount(null);
                        }}
                        sx={{ flex: 1 }}
                      />
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={handleValidateCoupon}
                        disabled={validatingCoupon || !couponCode.trim()}
                      >
                        {validatingCoupon ? <CircularProgress size={20} /> : 'Aplicar'}
                      </Button>
                    </Box>
                    {couponValid === true && couponDiscount && (
                      <Alert severity="success" sx={{ mt: 1 }}>
                        Cupom aplicado! Desconto de R${' '}
                        {(couponDiscount / 100).toFixed(2).replace('.', ',')}
                      </Alert>
                    )}
                  </Box>
                )}

                {currentPlanId === plan.id ? (
                  <Box>
                    <Button variant="outlined" fullWidth disabled sx={{ mb: 1 }}>
                      Plano Atual
                    </Button>
                    {plan.id === 'standard' && hasSubscription && (
                      <Button
                        variant="text"
                        color="destructive"
                        fullWidth
                        size="small"
                        onClick={() => setCancelDialogOpen(true)}
                      >
                        Cancelar assinatura
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
                      'Em breve'
                    ) : plan.id === 'free' ? (
                      'Gratuito'
                    ) : (
                      `Assinar ${plan.name}`
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </Box>
      </Container>

      <Dialog open={cancelDialogOpen} onClose={() => setCancelDialogOpen(false)}>
        <DialogTitle>Cancelar assinatura</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Tem certeza que deseja cancelar sua assinatura? Voce perdera acesso aos recursos do
            plano Standard.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelDialogOpen(false)}>Voltar</Button>
          <Button onClick={handleCancelSubscription} color="destructive" disabled={canceling}>
            {canceling ? <CircularProgress size={20} /> : 'Confirmar cancelamento'}
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
