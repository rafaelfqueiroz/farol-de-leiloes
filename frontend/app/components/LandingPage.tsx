'use client';

import { useRouter } from 'next/navigation';
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

const FEATURES = [
  {
    icon: <HomeWorkIcon sx={{ fontSize: 40 }} />,
    title: 'Mais de 35 mil imóveis',
    description:
      'Acesse o maior catálogo de imóveis de leilão da Caixa com descontos de até 70% do valor de mercado.',
    highlight: 'até 70% de desconto',
  },
  {
    icon: <PaymentsIcon sx={{ fontSize: 40 }} />,
    title: 'Condições de Pagamento Flexíveis',
    description:
      'Escolha as condições que melhor se encaixam no seu bolso: financiamento, FGTS ou pagamento à vista.',
    highlight: 'Use seu FGTS',
  },
  {
    icon: <AnalyticsIcon sx={{ fontSize: 40 }} />,
    title: 'Análise de Risco do Imóvel',
    description: 'Verifique a situação jurídica e ocupacional do imóvel antes de dar seu lance.',
    highlight: 'Segurança na compra',
  },
  {
    icon: <CalculateIcon sx={{ fontSize: 40 }} />,
    title: 'Simulador de Aquisição',
    description: 'Calcule o ROI e simule seu investimento para tomar a melhor decisão.',
    highlight: 'Planeje seu investimento',
  },
  {
    icon: <SecurityIcon sx={{ fontSize: 40 }} />,
    title: 'Verificação de Documentação',
    description: 'Análise completa de matrículas, certidões e situação do imóvel.',
    highlight: 'Documentação em dia',
  },
  {
    icon: <TrendingUpIcon sx={{ fontSize: 40 }} />,
    title: 'Alertas de Oportunidades',
    description: 'Receba notificações quando imóveis do seu interesse entrarem em leilão.',
    highlight: 'Não perca nenhuma oferta',
  },
];

const PRICING_PLANS = [
  {
    name: 'Gratuito',
    price: 'R$ 0',
    period: '/mês',
    description: 'Para quem está começando a explorar oportunidades',
    features: [
      { text: 'Busca manual por filtros', included: true },
      { text: 'Favoritar imóveis', included: true },
      { text: 'Filtros salvos (até 10)', included: true },
      { text: 'Busca por IA', included: false },
      { text: 'Suporte prioritário', included: false },
      { text: 'Alertas personalizados', included: false },
      { text: 'Relatórios avançados', included: false },
    ],
    buttonText: 'Começar Grátis',
    highlighted: false,
    disabled: false,
  },
  {
    name: 'Standard',
    price: 'R$ 29,90',
    period: '/mês',
    description: 'Ferramentas inteligentes para encontrar as melhores oportunidades',
    features: [
      { text: 'Busca manual por filtros', included: true },
      { text: 'Favoritar imóveis', included: true },
      { text: 'Filtros salvos (até 10)', included: true },
      { text: 'Busca por IA', included: true },
      { text: 'Suporte prioritário', included: true },
      { text: 'Alertas personalizados', included: false },
      { text: 'Relatórios avançados', included: false },
    ],
    buttonText: 'Assinar Agora',
    highlighted: true,
    disabled: false,
  },
  {
    name: 'Premium',
    price: 'Em breve',
    period: '',
    description: 'Todas as ferramentas para investir com segurança',
    features: [
      { text: 'Busca manual por filtros', included: true },
      { text: 'Favoritar imóveis', included: true },
      { text: 'Filtros salvos (até 10)', included: true },
      { text: 'Busca por IA', included: true },
      { text: 'Suporte prioritário', included: true },
      { text: 'Alertas personalizados', included: true },
      { text: 'Relatórios avançados', included: true },
    ],
    buttonText: 'Em Breve',
    highlighted: false,
    disabled: true,
  },
];

export default function LandingPage() {
  const router = useRouter();

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
              Planos
            </Button>
            <Button variant="contained" startIcon={<LoginIcon />} onClick={handleLogin}>
              Entrar
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
                  label="Leilões da Caixa Econômica Federal"
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
                  Encontre o imóvel dos seus sonhos com até{' '}
                  {/* DS-24: a favourable figure, not the brand colour; the words carry the meaning (DS-10) */}
                  <Box component="span" sx={{ color: 'figure.positive' }}>
                    70% de desconto
                  </Box>
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
                  Mais de 35 mil imóveis disponíveis em todo o Brasil. Casas, apartamentos, terrenos
                  e imóveis comerciais com condições especiais de pagamento.
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
                  Comece Agora
                </Button>
              </Box>

              {/* Stats */}
              <Box sx={{ display: 'flex', gap: 4, mt: 4, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="h4" fontWeight={700}>
                    35k+
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    Imóveis disponíveis
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="h4" fontWeight={700}>
                    27
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    Estados atendidos
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="h4" fontWeight={700}>
                    70%
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    Desconto máximo
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
            Por que usar o Farol dos Leilões?
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ maxWidth: 600, mx: 'auto' }}>
            Todas as ferramentas que você precisa para encontrar e adquirir o imóvel perfeito
          </Typography>
        </Box>

        <Grid container spacing={4}>
          {FEATURES.map((feature, index) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={index}>
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
                    {feature.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {feature.description}
                  </Typography>
                  <Chip
                    label={feature.highlight}
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
              Como funciona?
            </Typography>
            <Typography variant="h6" color="text.secondary">
              Em 4 passos simples você encontra o imóvel ideal
            </Typography>
          </Box>

          <Grid container spacing={4}>
            {[
              {
                step: '1',
                title: 'Cadastre-se',
                description: 'Crie sua conta gratuitamente em poucos minutos',
              },
              {
                step: '2',
                title: 'Busque',
                description: 'Filtre por estado, cidade, preço e tipo de imóvel',
              },
              {
                step: '3',
                title: 'Analise',
                description: 'Verifique os detalhes, fotos e situação do imóvel',
              },
              {
                step: '4',
                title: 'Arremate',
                description: 'Participe do leilão e conquiste seu imóvel',
              },
            ].map((item, index) => (
              <Grid size={{ xs: 12, sm: 6, md: 3 }} key={index}>
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
                    {item.step}
                  </Box>
                  <Typography variant="h6" fontWeight={600} sx={{ mb: 1, color: 'text.primary' }}>
                    {item.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {item.description}
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
            Escolha seu Plano
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ maxWidth: 600, mx: 'auto' }}>
            Comece gratuitamente ou desbloqueie funcionalidades com nossos planos
          </Typography>
        </Box>

        <Grid container spacing={4} sx={{ justifyContent: 'center' }}>
          {PRICING_PLANS.map((plan, index) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={index}>
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
                      label="Mais Popular"
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
                    {plan.name}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', mb: 2 }}>
                    {/* DS-24: a price is a figure, not a link */}
                    <Typography variant="h3" fontWeight={700} sx={{ color: 'text.primary' }}>
                      {plan.price}
                    </Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ ml: 1 }}>
                      {plan.period}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    {plan.description}
                  </Typography>

                  <Divider sx={{ mb: 3 }} />

                  <List dense>
                    {plan.features.map((feature, featureIndex) => (
                      <ListItem key={featureIndex} sx={{ px: 0 }}>
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          {feature.included ? (
                            <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
                          ) : (
                            <CancelIcon sx={{ fontSize: 20 }} />
                          )}
                        </ListItemIcon>
                        <ListItemText
                          primary={feature.text}
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
                    {plan.buttonText}
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
              Pronto para encontrar seu imóvel?
            </Typography>
            <Typography
              variant="h6"
              sx={(theme) => ({
                mb: 4,
                opacity: 0.9,
                ...theme.applyStyles('dark', { color: 'text.secondary', opacity: 1 }),
              })}
            >
              Crie sua conta gratuitamente e descubra oportunidades incríveis em todo o Brasil
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
              Criar Conta Grátis
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
              © 2024 Farol dos Leilões. Todos os direitos reservados.
            </Typography>
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
