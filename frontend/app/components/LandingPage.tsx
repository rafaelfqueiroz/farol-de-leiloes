'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Box,
  Container,
  Typography,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Grid,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  AppBar,
  Toolbar,
} from '@mui/material';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import PaymentsIcon from '@mui/icons-material/Payments';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import CalculateIcon from '@mui/icons-material/Calculate';
import SecurityIcon from '@mui/icons-material/Security';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GavelIcon from '@mui/icons-material/Gavel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import StarIcon from '@mui/icons-material/Star';
import LoginIcon from '@mui/icons-material/Login';
import Logo from '@/app/components/patterns/Logo';
import { formatMoney, formatPercent } from '@/lib/money';
import { formatCount } from '@/lib/numbers';

// DS-20: the copy lives in the `landing` catalogue under these ids; only structure stays here.
const FEATURES = [
  { id: 'catalogue', icon: <HomeWorkIcon sx={{ fontSize: 40 }} /> },
  { id: 'payment', icon: <PaymentsIcon sx={{ fontSize: 40 }} /> },
  { id: 'risk', icon: <AnalyticsIcon sx={{ fontSize: 40 }} /> },
  { id: 'simulator', icon: <CalculateIcon sx={{ fontSize: 40 }} /> },
  { id: 'documents', icon: <SecurityIcon sx={{ fontSize: 40 }} /> },
  { id: 'alerts', icon: <TrendingUpIcon sx={{ fontSize: 40 }} /> },
] as const;

const STEPS = ['signUp', 'search', 'analyse', 'win'] as const;

type PlanFeature =
  | 'manualSearch'
  | 'favorites'
  | 'savedFilters'
  | 'aiSearch'
  | 'prioritySupport'
  | 'customAlerts'
  | 'advancedReports';

const PRICING_PLANS: {
  id: 'free' | 'standard' | 'premium';
  // AR-17: an amount is a decimal string; null is a plan without a price yet
  price: string | null;
  features: { id: PlanFeature; included: boolean }[];
  highlighted: boolean;
  disabled: boolean;
}[] = [
  {
    id: 'free',
    price: '0',
    features: [
      { id: 'manualSearch', included: true },
      { id: 'favorites', included: true },
      { id: 'savedFilters', included: true },
      { id: 'aiSearch', included: false },
      { id: 'prioritySupport', included: false },
      { id: 'customAlerts', included: false },
      { id: 'advancedReports', included: false },
    ],
    highlighted: false,
    disabled: false,
  },
  {
    id: 'standard',
    price: '29.90',
    features: [
      { id: 'manualSearch', included: true },
      { id: 'favorites', included: true },
      { id: 'savedFilters', included: true },
      { id: 'aiSearch', included: true },
      { id: 'prioritySupport', included: true },
      { id: 'customAlerts', included: false },
      { id: 'advancedReports', included: false },
    ],
    highlighted: true,
    disabled: false,
  },
  {
    id: 'premium',
    price: null,
    features: [
      { id: 'manualSearch', included: true },
      { id: 'favorites', included: true },
      { id: 'savedFilters', included: true },
      { id: 'aiSearch', included: true },
      { id: 'prioritySupport', included: true },
      { id: 'customAlerts', included: true },
      { id: 'advancedReports', included: true },
    ],
    highlighted: false,
    disabled: true,
  },
];

// The headline figures of the pitch; shown through the shared formatters (DS-29).
const MAX_DISCOUNT = '70';
const STATES_SERVED = 27;
const SAVED_FILTERS_LIMIT = 10;

export default function LandingPage() {
  const router = useRouter();
  const t = useTranslations('landing');
  const tPlan = useTranslations('plan');
  const tCommon = useTranslations('common');
  const discount = formatPercent(MAX_DISCOUNT, 0);

  const handleLogin = () => {
    router.push('/login');
  };

  const scrollToPlanos = () => {
    const planosSection = document.getElementById('planos');
    if (planosSection) {
      planosSection.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <Box sx={{ minHeight: '100vh' }}>
      {/* Header: same surface as the AppShell top bar. MUI's AppBar repaints a coloured bar with
          its dark background in dark mode, which left primary.contrastText unreadable on it, so
          the bar is background.paper with text.primary links, legible in both schemes (DS-05,
          DS-24). */}
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          backgroundColor: 'background.paper',
          color: 'text.primary',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ justifyContent: 'space-between', gap: 1 }}>
          {/* DS-13: the lockup plus both links overflow a 360px screen, so below sm only the mark
              shows. display:none keeps exactly one accessible name exposed at a time. */}
          <ButtonBase
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            sx={{ minWidth: 44, minHeight: 44, borderRadius: 1 }}
          >
            <Box sx={{ display: { xs: 'flex', sm: 'none' } }}>
              <Logo variant="mark" size={32} />
            </Box>
            <Box sx={{ display: { xs: 'none', sm: 'flex' } }}>
              <Logo variant="lockup" size={28} />
            </Box>
          </ButtonBase>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 } }}>
            <Button
              color="inherit"
              onClick={scrollToPlanos}
              sx={{
                position: 'relative',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: 6,
                  left: 8,
                  right: 8,
                  height: (theme) => theme.spacing(0.25),
                  backgroundColor: 'currentColor',
                  transform: 'scaleX(0)',
                  transformOrigin: 'left',
                  transition: 'transform 0.3s ease',
                },
                '&:hover::after': {
                  transform: 'scaleX(1)',
                },
                '&:hover': {
                  backgroundColor: 'transparent',
                },
              }}
            >
              {t('nav.plans')}
            </Button>
            <Button variant="contained" startIcon={<LoginIcon />} onClick={handleLogin}>
              {tCommon('signIn')}
            </Button>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Hero Section */}
      <Box
        sx={{
          backgroundColor: 'primary.soft',
          color: 'text.primary',
          pt: { xs: 12, md: 16 },
          pb: { xs: 8, md: 12 },
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Container maxWidth="lg">
          <Grid container spacing={4} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, md: 7 }}>
              <Box sx={{ mb: 4 }}>
                <Chip
                  icon={<GavelIcon />}
                  label={t('hero.badge')}
                  variant="outlined"
                  sx={{
                    mb: 2,
                    '& .MuiChip-icon': { color: 'text.secondary' },
                  }}
                />
                <Typography
                  variant="h2"
                  sx={{
                    fontWeight: 700,
                    fontSize: { xs: '2rem', md: '3rem' },
                    mb: 2,
                    lineHeight: 1.2,
                  }}
                >
                  {t.rich('hero.title', {
                    discount,
                    // DS-24: a favourable figure, not the brand colour; the words carry the meaning (DS-10)
                    highlight: (chunks) => (
                      <Box component="span" sx={{ color: 'figure.positive' }}>
                        {chunks}
                      </Box>
                    ),
                  })}
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 400,
                    opacity: 0.9,
                    mb: 4,
                    fontSize: { xs: '1rem', md: '1.25rem' },
                  }}
                >
                  {t('hero.subtitle')}
                </Typography>
                <Button
                  variant="contained"
                  size="large"
                  onClick={handleLogin}
                  sx={{
                    px: 4,
                    py: 1.5,
                    fontSize: '1rem',
                    fontWeight: 600,
                  }}
                >
                  {t('hero.cta')}
                </Button>
              </Box>

              {/* Stats */}
              <Box sx={{ display: 'flex', gap: 4, mt: 4, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="h4" fontWeight={700}>
                    {t('hero.stats.properties.value')}
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    {t('hero.stats.properties.label')}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="h4" fontWeight={700}>
                    {formatCount(STATES_SERVED)}
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    {t('hero.stats.states.label')}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="h4" fontWeight={700}>
                    {discount}
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    {t('hero.stats.discount.label')}
                  </Typography>
                </Box>
              </Box>
            </Grid>

            <Grid size={{ xs: 12, md: 5 }} sx={{ display: { xs: 'none', md: 'block' } }}>
              <Box
                sx={{
                  position: 'relative',
                  height: 400,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Box
                  sx={{
                    width: 300,
                    height: 300,
                    borderRadius: '50%',
                    backgroundColor: 'background.paper',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <HomeWorkIcon sx={{ fontSize: 150, color: 'primary.main' }} />
                </Box>
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Features Section */}
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <Typography variant="h3" fontWeight={700} sx={{ mb: 2, color: 'text.primary' }}>
            {t('features.title')}
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ maxWidth: 600, mx: 'auto' }}>
            {t('features.subtitle')}
          </Typography>
        </Box>

        <Grid container spacing={4}>
          {FEATURES.map((feature) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={feature.id}>
              <Card
                sx={{
                  height: '100%',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 4,
                  },
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      borderRadius: 2,
                      backgroundColor: 'primary.main',
                      color: 'primary.contrastText',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mb: 2,
                    }}
                  >
                    {feature.icon}
                  </Box>
                  <Typography variant="h6" fontWeight={600} sx={{ mb: 1, color: 'text.primary' }}>
                    {t(`features.${feature.id}.title`)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t(`features.${feature.id}.description`, { discount })}
                  </Typography>
                  <Chip
                    label={t(`features.${feature.id}.highlight`, { discount })}
                    size="small"
                    sx={{
                      backgroundColor: 'background.muted',
                      color: 'text.primary',
                      fontWeight: 500,
                    }}
                  />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>

      {/* How It Works Section */}
      <Box sx={{ backgroundColor: 'primary.soft', py: 8 }}>
        <Container maxWidth="lg">
          <Box sx={{ textAlign: 'center', mb: 6 }}>
            <Typography variant="h3" fontWeight={700} sx={{ mb: 2, color: 'text.primary' }}>
              {t('howItWorks.title')}
            </Typography>
            <Typography variant="h6" color="text.secondary">
              {t('howItWorks.subtitle')}
            </Typography>
          </Box>

          <Grid container spacing={4}>
            {STEPS.map((step, index) => (
              <Grid size={{ xs: 12, sm: 6, md: 3 }} key={step}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box
                    sx={{
                      width: 60,
                      height: 60,
                      borderRadius: '50%',
                      backgroundColor: 'primary.main',
                      color: 'primary.contrastText',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mx: 'auto',
                      mb: 2,
                      fontSize: '1.5rem',
                      fontWeight: 700,
                    }}
                  >
                    {formatCount(index + 1)}
                  </Box>
                  <Typography variant="h6" fontWeight={600} sx={{ mb: 1, color: 'text.primary' }}>
                    {t(`howItWorks.${step}.title`)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(`howItWorks.${step}.description`)}
                  </Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* Pricing Section */}
      <Container id="planos" maxWidth="lg" sx={{ py: 8, scrollMarginTop: '80px' }}>
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <Typography variant="h3" fontWeight={700} sx={{ mb: 2, color: 'text.primary' }}>
            {t('pricing.title')}
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ maxWidth: 600, mx: 'auto' }}>
            {t('pricing.subtitle')}
          </Typography>
        </Box>

        <Grid container spacing={4} sx={{ justifyContent: 'center' }}>
          {PRICING_PLANS.map((plan) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={plan.id}>
              <Card
                sx={{
                  height: '100%',
                  position: 'relative',
                  // DESIGN.md §2: the featured plan is one of amber's rare highlights
                  border: plan.highlighted ? 2 : 1,
                  borderColor: plan.highlighted ? 'secondary.main' : 'divider',
                  transform: plan.highlighted ? 'scale(1.02)' : 'none',
                  opacity: plan.disabled ? 0.7 : 1,
                }}
              >
                {plan.highlighted && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: -12,
                      left: '50%',
                      transform: 'translateX(-50%)',
                    }}
                  >
                    <Chip
                      icon={<StarIcon sx={{ fontSize: 16 }} />}
                      label={tPlan('popular')}
                      sx={{
                        backgroundColor: 'secondary.main',
                        color: 'secondary.contrastText',
                        fontWeight: 600,
                        '& .MuiChip-icon': { color: 'secondary.contrastText' },
                      }}
                    />
                  </Box>
                )}
                <CardContent sx={{ p: 4 }}>
                  <Typography variant="h5" fontWeight={700} sx={{ mb: 1, color: 'text.primary' }}>
                    {tPlan(`names.${plan.id}`)}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', mb: 2 }}>
                    {/* DS-24: a price is a figure, not a link */}
                    <Typography variant="h3" fontWeight={700} sx={{ color: 'text.primary' }}>
                      {plan.price === null ? tPlan('comingSoon') : formatMoney(plan.price)}
                    </Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ ml: 1 }}>
                      {plan.price === null ? null : tPlan('period')}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    {t(`pricing.${plan.id}.description`)}
                  </Typography>

                  <Divider sx={{ mb: 3 }} />

                  <List dense>
                    {plan.features.map((feature) => (
                      <ListItem key={feature.id} sx={{ px: 0 }}>
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          {feature.included ? (
                            <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
                          ) : (
                            <CancelIcon sx={{ fontSize: 20 }} />
                          )}
                        </ListItemIcon>
                        <ListItemText
                          primary={tPlan(`features.${feature.id}`, {
                            limit: formatCount(SAVED_FILTERS_LIMIT),
                          })}
                          slotProps={{
                            primary: {
                              variant: 'body2',
                              color: feature.included ? 'text.primary' : 'text.secondary',
                            },
                          }}
                        />
                      </ListItem>
                    ))}
                  </List>

                  <Button
                    variant={plan.highlighted ? 'contained' : 'outlined'}
                    fullWidth
                    size="large"
                    disabled={plan.disabled}
                    onClick={handleLogin}
                    sx={{ mt: 3 }}
                  >
                    {t(`pricing.${plan.id}.cta`)}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>

      {/* CTA Section */}
      <Box
        sx={(theme) => ({
          backgroundColor: 'primary.main',
          color: 'primary.contrastText',
          py: 8,
          // Dark: the light-blue primary fill would be the loudest thing on the page,
          // so the band sits on primary.soft with ink text (DS-01).
          ...theme.applyStyles('dark', {
            backgroundColor: 'primary.soft',
            color: 'text.primary',
          }),
        })}
      >
        <Container maxWidth="md">
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h3" fontWeight={700} sx={{ mb: 2 }}>
              {t('cta.title')}
            </Typography>
            <Typography
              variant="h6"
              sx={(theme) => ({
                mb: 4,
                opacity: 0.9,
                ...theme.applyStyles('dark', { color: 'text.secondary', opacity: 1 }),
              })}
            >
              {t('cta.subtitle')}
            </Typography>
            <Button
              variant="contained"
              size="large"
              onClick={handleLogin}
              sx={(theme) => ({
                // inverse button on the brand band (light only)
                backgroundColor: 'primary.contrastText',
                color: 'primary.main',
                px: 6,
                py: 1.5,
                fontSize: '1.1rem',
                fontWeight: 600,
                border: 1,
                borderColor: 'transparent',
                '&:hover': {
                  backgroundColor: 'transparent',
                  color: 'primary.contrastText',
                  borderColor: 'primary.contrastText',
                },
                // Dark: the standard contained primary Button (primary.main fill, contrastText label).
                ...theme.applyStyles('dark', {
                  backgroundColor: 'primary.main',
                  color: 'primary.contrastText',
                  '&:hover': {
                    backgroundColor: 'primary.dark',
                    color: 'primary.contrastText',
                    borderColor: 'transparent',
                  },
                }),
              })}
            >
              {t('cta.button')}
            </Button>
          </Box>
        </Container>
      </Box>

      {/* Footer: paper surface with a divider, matching the header in both schemes */}
      <Box
        sx={{
          backgroundColor: 'background.paper',
          color: 'text.primary',
          borderTop: 1,
          borderColor: 'divider',
          py: 4,
        }}
      >
        <Container maxWidth="lg">
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 2,
            }}
          >
            <Logo variant="lockup" size={28} />
            <Typography variant="body2" color="text.secondary">
              {t('footer.rights')}
            </Typography>
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
