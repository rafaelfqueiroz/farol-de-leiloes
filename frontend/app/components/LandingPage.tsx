'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Theme } from '@mui/material/styles';
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
import SiteFooter from '@/app/components/patterns/SiteFooter';
import { formatMoney, formatPercent } from '@/lib/money';
import { formatCount } from '@/lib/numbers';

// DS-01: a size is a multiple of the theme's spacing unit, never a pixel literal.
const space = (units: number) => (theme: Theme) => theme.spacing(units);

// DS-20: the copy lives in the `landing` catalogue under these ids; only structure stays here.
const FEATURES = [
  { id: 'catalogue', icon: <HomeWorkIcon sx={{ fontSize: space(5) }} /> },
  { id: 'payment', icon: <PaymentsIcon sx={{ fontSize: space(5) }} /> },
  { id: 'risk', icon: <AnalyticsIcon sx={{ fontSize: space(5) }} /> },
  { id: 'simulator', icon: <CalculateIcon sx={{ fontSize: space(5) }} /> },
  { id: 'documents', icon: <SecurityIcon sx={{ fontSize: space(5) }} /> },
  { id: 'alerts', icon: <TrendingUpIcon sx={{ fontSize: space(5) }} /> },
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
            sx={{ minWidth: space(5.5), minHeight: space(5.5), borderRadius: 1 }}
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
                  bottom: space(0.75),
                  left: space(1),
                  right: space(1),
                  height: space(0.25),
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
                {/* DS-15: the page's only h1; `display` is the one size above h1 (DS-11) */}
                <Typography variant="display" component="h1" sx={{ mb: 2, textWrap: 'balance' }}>
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
                <Typography variant="subtitle1" component="p" color="text.secondary" sx={{ mb: 4 }}>
                  {t('hero.subtitle')}
                </Typography>
                <Button variant="contained" size="large" onClick={handleLogin} sx={{ px: 4 }}>
                  {t('hero.cta')}
                </Button>
              </Box>

              {/* Stats */}
              <Box sx={{ display: 'flex', gap: 4, mt: 4, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="metric" component="p">
                    {t('hero.stats.properties.value')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('hero.stats.properties.label')}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="metric" component="p">
                    {formatCount(STATES_SERVED)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('hero.stats.states.label')}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="metric" component="p">
                    {discount}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('hero.stats.discount.label')}
                  </Typography>
                </Box>
              </Box>
            </Grid>

            <Grid size={{ xs: 12, md: 5 }} sx={{ display: { xs: 'none', md: 'block' } }}>
              <Box
                sx={{
                  position: 'relative',
                  height: space(50),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Box
                  sx={{
                    width: space(37.5),
                    height: space(37.5),
                    borderRadius: '50%',
                    backgroundColor: 'background.paper',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <HomeWorkIcon sx={{ fontSize: space(19), color: 'primary.main' }} />
                </Box>
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Features Section */}
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <Typography variant="h2" sx={{ mb: 2 }}>
            {t('features.title')}
          </Typography>
          <Typography
            variant="subtitle1"
            component="p"
            color="text.secondary"
            sx={{ maxWidth: space(75), mx: 'auto' }}
          >
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
                    transform: (theme) => `translateY(${theme.spacing(-0.5)})`,
                    boxShadow: 4,
                  },
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Box
                    sx={{
                      width: space(8),
                      height: space(8),
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
                  <Typography variant="h5" component="h3" sx={{ mb: 1 }}>
                    {t(`features.${feature.id}.title`)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t(`features.${feature.id}.description`, { discount })}
                  </Typography>
                  <Chip
                    label={t(`features.${feature.id}.highlight`, { discount })}
                    size="small"
                    sx={{ backgroundColor: 'background.muted', color: 'text.primary' }}
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
            <Typography variant="h2" sx={{ mb: 2 }}>
              {t('howItWorks.title')}
            </Typography>
            <Typography variant="subtitle1" component="p" color="text.secondary">
              {t('howItWorks.subtitle')}
            </Typography>
          </Box>

          <Grid container spacing={4}>
            {STEPS.map((step, index) => (
              <Grid size={{ xs: 12, sm: 6, md: 3 }} key={step}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box
                    sx={{
                      width: space(7.5),
                      height: space(7.5),
                      borderRadius: '50%',
                      backgroundColor: 'primary.main',
                      color: 'primary.contrastText',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mx: 'auto',
                      mb: 2,
                      typography: 'h3',
                    }}
                  >
                    {formatCount(index + 1)}
                  </Box>
                  <Typography variant="h5" component="h3" sx={{ mb: 1 }}>
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
      <Container id="planos" maxWidth="lg" sx={{ py: 8, scrollMarginTop: space(10) }}>
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <Typography variant="h2" sx={{ mb: 2 }}>
            {t('pricing.title')}
          </Typography>
          <Typography
            variant="subtitle1"
            component="p"
            color="text.secondary"
            sx={{ maxWidth: space(75), mx: 'auto' }}
          >
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
                      top: space(-1.5),
                      left: '50%',
                      transform: 'translateX(-50%)',
                    }}
                  >
                    <Chip
                      icon={<StarIcon />}
                      label={tPlan('popular')}
                      sx={{
                        backgroundColor: 'secondary.main',
                        color: 'secondary.contrastText',
                        '& .MuiChip-icon': { color: 'secondary.contrastText' },
                      }}
                    />
                  </Box>
                )}
                <CardContent sx={{ p: 4 }}>
                  <Typography variant="h4" component="h3" sx={{ mb: 1 }}>
                    {tPlan(`names.${plan.id}`)}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', mb: 2 }}>
                    {/* DS-24: a price is a figure, not a link */}
                    <Typography variant="metric" component="p">
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
                        <ListItemIcon sx={{ minWidth: space(4) }}>
                          {feature.included ? (
                            <CheckCircleIcon fontSize="small" sx={{ color: 'success.main' }} />
                          ) : (
                            <CancelIcon fontSize="small" />
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
            <Typography variant="h2" sx={{ mb: 2 }}>
              {t('cta.title')}
            </Typography>
            <Typography
              variant="subtitle1"
              component="p"
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

      {/* BR-010-02: the shared footer (terms, privacy, support) replaces the inline one */}
      <SiteFooter />
    </Box>
  );
}
