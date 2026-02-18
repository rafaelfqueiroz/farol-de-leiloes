'use client';

import { useRouter } from 'next/navigation';
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Chip,
  IconButton,
  Divider,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  ThemeProvider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import HomeIcon from '@mui/icons-material/Home';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import LinkIcon from '@mui/icons-material/Link';
import PaymentIcon from '@mui/icons-material/Payment';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import DownloadIcon from '@mui/icons-material/Download';
import DescriptionIcon from '@mui/icons-material/Description';
import { useFavorites } from '../../contexts/FavoritesContext';
import Sidebar from '../../components/Sidebar';
import TopBar from '../../components/TopBar';
import theme from '../../theme';

interface ExpenseRule {
  type: string;
  description: string;
}

interface Phase {
  modality: string;
  minimumPrice?: number;
  phaseDates?: string[];
  paymentMethods?: string[];
  expenseRules?: ExpenseRule[];
}

interface Address {
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipcode?: string;
}

export interface Auction {
  code: string;
  title: string;
  address: Address;
  appraisalPrice?: number;
  phases: Phase[];
  detailsUrl?: string;
  imageUrl?: string;
  matriculaUrl?: string;
  editalUrl?: string;
  description?: string;
  fulfilled?: boolean;
  available?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const MODALITY_LABELS: Record<string, string> = {
  SFI_AUCTION: 'Leilão SFI',
  OPEN_BIDDING: 'Licitação Aberta',
  DIRECT_ONLINE_SALES: 'Venda Direta Online',
  ONLINE_SALES: 'Venda Online',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  OWN_RESOURCES: 'Recursos Próprios',
  FGTS: 'FGTS',
  FINANCING: 'Financiamento',
};

const DOCUMENT_LABELS: Record<string, string> = {
  matricula: 'Matrícula do Imóvel',
  edital: 'Edital e Anexos',
};

function formatCurrency(value?: number): string {
  if (!value) return 'N/A';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function formatDate(dateString?: string): string {
  if (!dateString) return 'Não informado';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

function formatAddress(address: Address): string {
  const parts = [
    address.street,
    address.neighborhood,
    address.city,
    address.state,
  ].filter(Boolean);
  return parts.join(', ') || 'Endereço não informado';
}

interface AuctionDetailClientProps {
  auction: Auction;
}

export default function AuctionDetailClient({ auction }: AuctionDetailClientProps) {
  const router = useRouter();
  const { isFavorite, toggleFavorite } = useFavorites();

  const getReturnUrl = () => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const returnUrl = urlParams.get('returnUrl');
      return returnUrl || '/';
    }
    return '/';
  };

  const handleDownloadDocument = (type: 'matricula' | 'edital') => {
    const url = type === 'matricula' ? auction.matriculaUrl : auction.editalUrl;
    if (url) {
      window.open(url, '_blank');
    }
  };

  const lastPhase = auction.phases[auction.phases.length - 1];
  const discount = auction.appraisalPrice && lastPhase?.minimumPrice
    ? ((auction.appraisalPrice - lastPhase.minimumPrice) / auction.appraisalPrice) * 100
    : null;

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: '#FAFAF9' }}>
        <Sidebar activeView="search" onViewChange={() => router.push('/')} />

        <Box sx={{ flexGrow: 1, ml: '72px' }}>
          <TopBar />

          <Box component="main" sx={{ pt: 10, pb: 4 }}>
            <Container maxWidth="xl">
              <Box>
                {/* Header */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                  <IconButton onClick={() => router.push(getReturnUrl())} size="large">
                    <ArrowBackIcon />
                  </IconButton>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="h4" fontWeight={600}>
                      {auction.title || 'Imóvel sem título'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Código: {auction.code}
                    </Typography>
                  </Box>
                  <IconButton
                    onClick={() => toggleFavorite(auction)}
                    size="large"
                    sx={{
                      color: isFavorite(auction.code) ? 'error.main' : 'action.active',
                      '&:hover': {
                        color: 'error.main',
                      },
                    }}
                  >
                    {isFavorite(auction.code) ? <FavoriteIcon fontSize="large" /> : <FavoriteBorderIcon fontSize="large" />}
                  </IconButton>
                </Box>

                {/* Property Image */}
                <Card sx={{ mb: 3 }}>
                  <Box
                    sx={{
                      width: '100%',
                      height: 400,
                      overflow: 'hidden',
                      backgroundColor: '#e0e0e0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    {auction.imageUrl ? (
                      <img
                        src={auction.imageUrl}
                        alt={auction.title || 'Imóvel'}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const parent = e.currentTarget.parentElement;
                          if (parent) {
                            const placeholder = parent.querySelector('.placeholder-text');
                            if (placeholder) {
                              (placeholder as HTMLElement).style.display = 'flex';
                            }
                          }
                        }}
                      />
                    ) : null}
                    <Box
                      className="placeholder-text"
                      sx={{
                        display: auction.imageUrl ? 'none' : 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'text.secondary',
                        position: 'absolute',
                        inset: 0,
                      }}
                    >
                      <HomeIcon sx={{ fontSize: 60, mb: 1, opacity: 0.5 }} />
                      <Typography variant="body2" color="text.secondary">
                        Sem imagem
                      </Typography>
                    </Box>
                  </Box>
                </Card>

                {/* Main Info Card */}
                <Card sx={{ mb: 3 }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 3 }}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="h6" fontWeight={600} gutterBottom>
                          Informações do Imóvel
                        </Typography>
                      </Box>
                      {lastPhase && (
                        <Chip
                          label={MODALITY_LABELS[lastPhase.modality] || lastPhase.modality}
                          color="primary"
                          size="medium"
                        />
                      )}
                    </Box>

                    <Divider sx={{ mb: 3 }} />

                    {/* Address */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 3 }}>
                      <LocationOnIcon sx={{ color: 'primary.main', mt: 0.5 }} />
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Endereço
                        </Typography>
                        <Typography variant="body1">
                          {formatAddress(auction.address)}
                        </Typography>
                        {auction.address.zipcode && (
                          <Typography variant="body2" color="text.secondary">
                            CEP: {auction.address.zipcode}
                          </Typography>
                        )}
                      </Box>
                    </Box>

                    {/* Prices */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 3, mb: 3 }}>
                      {auction.appraisalPrice && (
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                          <HomeIcon sx={{ color: 'info.main' }} />
                          <Box>
                            <Typography variant="subtitle2" color="text.secondary">
                              Valor de Avaliação
                            </Typography>
                            <Typography variant="h6" fontWeight={600} color="info.main">
                              {formatCurrency(auction.appraisalPrice)}
                            </Typography>
                          </Box>
                        </Box>
                      )}

                      {lastPhase?.minimumPrice && (
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                          <AttachMoneyIcon sx={{ color: 'success.main' }} />
                          <Box>
                            <Typography variant="subtitle2" color="text.secondary">
                              Lance Mínimo Atual
                            </Typography>
                            <Typography variant="h6" fontWeight={600} color="success.main">
                              {formatCurrency(lastPhase.minimumPrice)}
                            </Typography>
                            {discount !== null && (
                              <Chip
                                label={`${discount.toFixed(1)}% de desconto`}
                                color="success"
                                size="small"
                                sx={{ mt: 0.5 }}
                              />
                            )}
                          </Box>
                        </Box>
                      )}

                      {lastPhase?.phaseDates && lastPhase.phaseDates.length > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                          <CalendarTodayIcon sx={{ color: 'warning.main' }} />
                          <Box>
                            <Typography variant="subtitle2" color="text.secondary">
                              {lastPhase.phaseDates.length > 1 ? 'Datas do Leilão' : 'Data do Leilão'}
                            </Typography>
                            {lastPhase.phaseDates.map((date, idx) => (
                              <Typography key={idx} variant="body1" fontWeight={600}>
                                {lastPhase.phaseDates!.length > 1 ? `${idx + 1}º Leilão: ` : ''}{formatDate(date)}
                              </Typography>
                            ))}
                          </Box>
                        </Box>
                      )}
                    </Box>

                    {/* Payment Methods */}
                    {lastPhase?.paymentMethods && lastPhase.paymentMethods.length > 0 && (
                      <>
                        <Divider sx={{ mb: 3 }} />
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 3 }}>
                          <PaymentIcon sx={{ color: 'primary.main', mt: 0.5 }} />
                          <Box>
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                              Formas de Pagamento Aceitas
                            </Typography>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                              {lastPhase.paymentMethods.map((method, idx) => (
                                <Chip
                                  key={idx}
                                  label={PAYMENT_METHOD_LABELS[method] || method}
                                  variant="outlined"
                                  color="primary"
                                  size="small"
                                />
                              ))}
                            </Box>
                          </Box>
                        </Box>
                      </>
                    )}

                    {/* Expense Rules */}
                    {lastPhase?.expenseRules && lastPhase.expenseRules.length > 0 && (
                      <>
                        <Divider sx={{ mb: 3 }} />
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 3 }}>
                          <ReceiptLongIcon sx={{ color: 'warning.main', mt: 0.5 }} />
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                              Regras para Pagamento das Despesas
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              {lastPhase.expenseRules.map((rule, idx) => (
                                <Box key={idx} sx={{ backgroundColor: 'grey.50', p: 1.5, borderRadius: 1 }}>
                                  <Typography variant="body2" fontWeight={600} color="text.primary">
                                    {rule.type}
                                  </Typography>
                                  <Typography variant="body2" color="text.secondary">
                                    {rule.description}
                                  </Typography>
                                </Box>
                              ))}
                            </Box>
                          </Box>
                        </Box>
                      </>
                    )}

                    {/* Documents */}
                    {(auction.matriculaUrl || auction.editalUrl) && (
                      <>
                        <Divider sx={{ mb: 3 }} />
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 3 }}>
                          <DescriptionIcon sx={{ color: 'secondary.main', mt: 0.5 }} />
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                              Documentos Disponíveis
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                              {auction.matriculaUrl && (
                                <Button
                                  variant="outlined"
                                  size="small"
                                  startIcon={<DownloadIcon />}
                                  onClick={() => handleDownloadDocument('matricula')}
                                >
                                  {DOCUMENT_LABELS.matricula}
                                </Button>
                              )}
                              {auction.editalUrl && (
                                <Button
                                  variant="outlined"
                                  size="small"
                                  startIcon={<DownloadIcon />}
                                  onClick={() => handleDownloadDocument('edital')}
                                >
                                  {DOCUMENT_LABELS.edital}
                                </Button>
                              )}
                            </Box>
                          </Box>
                        </Box>
                      </>
                    )}

                    {/* External Link */}
                    {auction.detailsUrl && (
                      <>
                        <Divider sx={{ mb: 2 }} />
                        <Button
                          component="a"
                          href={auction.detailsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="outlined"
                          startIcon={<LinkIcon />}
                          fullWidth
                        >
                          Ver detalhes completos no site da Caixa
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Phases History */}
                {auction.phases.length > 0 && (
                  <Card>
                    <CardContent>
                      <Typography variant="h6" fontWeight={600} gutterBottom>
                        Histórico de Fases
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {auction.phases.length} fase{auction.phases.length !== 1 ? 's' : ''} registrada{auction.phases.length !== 1 ? 's' : ''}
                      </Typography>

                      <TableContainer component={Paper} variant="outlined">
                        <Table>
                          <TableHead>
                            <TableRow>
                              <TableCell><strong>Fase</strong></TableCell>
                              <TableCell><strong>Modalidade</strong></TableCell>
                              <TableCell align="right"><strong>Lance Mínimo</strong></TableCell>
                              <TableCell><strong>Data(s)</strong></TableCell>
                              <TableCell><strong>Pagamento</strong></TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {auction.phases.map((phase, index) => (
                              <TableRow key={index} sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                                <TableCell>#{index + 1}</TableCell>
                                <TableCell>
                                  <Chip
                                    label={MODALITY_LABELS[phase.modality] || phase.modality}
                                    size="small"
                                    color={index === auction.phases.length - 1 ? 'primary' : 'default'}
                                  />
                                </TableCell>
                                <TableCell align="right">
                                  {formatCurrency(phase.minimumPrice)}
                                </TableCell>
                                <TableCell>
                                  {phase.phaseDates && phase.phaseDates.length > 0
                                    ? phase.phaseDates.map((d, i) => (
                                        <Box key={i} component="span" sx={{ display: 'block' }}>
                                          {new Date(d).toLocaleDateString('pt-BR', { dateStyle: 'short' })}
                                          {' '}
                                          {new Date(d).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}
                                        </Box>
                                      ))
                                    : 'Não informado'}
                                </TableCell>
                                <TableCell>
                                  {phase.paymentMethods && phase.paymentMethods.length > 0 ? (
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                      {phase.paymentMethods.map((method, idx) => (
                                        <Chip
                                          key={idx}
                                          label={PAYMENT_METHOD_LABELS[method] || method}
                                          size="small"
                                          variant="outlined"
                                        />
                                      ))}
                                    </Box>
                                  ) : (
                                    <Typography variant="body2" color="text.secondary">-</Typography>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </CardContent>
                  </Card>
                )}

                {/* Last Updated */}
                {auction.updatedAt && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 3 }}>
                    Última atualização: {formatDate(auction.updatedAt)}
                  </Typography>
                )}
              </Box>
            </Container>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
