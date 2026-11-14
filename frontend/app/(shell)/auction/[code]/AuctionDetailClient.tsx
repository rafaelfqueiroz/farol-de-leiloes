'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
import { useFavorites } from '@/app/contexts/FavoritesContext';
import { useAuth } from '@/app/contexts/AuthContext';
import { hasMinimumRole } from '@/app/components/RequireRole';
import { useAuctionLabels } from '@/app/components/AuctionCard';
import Money from '@/app/components/patterns/Money';
import DateText from '@/app/components/patterns/DateText';
import type { AuctionDetail } from '@/lib/auction';
import { discountPercent, formatPercent } from '@/lib/money';

const ADDRESS_PARTS = ['street', 'neighborhood', 'city', 'state'] as const;

interface AuctionDetailClientProps {
  auction: AuctionDetail;
}

export default function AuctionDetailClient({ auction }: AuctionDetailClientProps) {
  const t = useTranslations('auctionDetail');
  const tCard = useTranslations('auctionCard');
  const tCommon = useTranslations('common');
  const labels = useAuctionLabels();
  const router = useRouter();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { role } = useAuth();
  const canAccessFavorites = hasMinimumRole(role, 'standard');

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

  const address = ADDRESS_PARTS.map((part) => auction.address[part])
    .filter(Boolean)
    .join(', ');
  const { updatedAt } = auction;
  const lastPhase = auction.phases[auction.phases.length - 1];
  // AR-17: Decimal arithmetic on the money strings, never JS numbers
  const discount = discountPercent(auction.appraisalPrice, lastPhase?.minimumPrice ?? null);

  return (
    // #42: the AppShell owns the top bar, navigation and <main>; pt no longer offsets a fixed bar
    <Box sx={{ pt: 2, pb: 4 }}>
      <Container maxWidth="xl">
        <Box>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <IconButton
              aria-label={tCommon('back')}
              onClick={() => router.push(getReturnUrl())}
              size="large"
              sx={{
                '&:hover': {
                  backgroundColor: 'action.hover',
                },
              }}
            >
              <ArrowBackIcon />
            </IconButton>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h4" fontWeight={600}>
                {auction.title || tCard('untitled')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {tCard('code', { code: auction.code })}
              </Typography>
            </Box>
            {canAccessFavorites && (
              <IconButton
                aria-label={
                  isFavorite(auction.code) ? tCard('favorite.remove') : tCard('favorite.add')
                }
                onClick={() => toggleFavorite(auction)}
                size="large"
                sx={{
                  color: isFavorite(auction.code) ? 'error.main' : 'action.active',
                  '&:hover': {
                    color: 'error.main',
                    backgroundColor: 'action.hover',
                  },
                }}
              >
                {isFavorite(auction.code) ? (
                  <FavoriteIcon fontSize="large" />
                ) : (
                  <FavoriteBorderIcon fontSize="large" />
                )}
              </IconButton>
            )}
          </Box>

          {/* Property Image */}
          <Card sx={{ mb: 3 }}>
            <Box
              sx={{
                width: '100%',
                height: 400,
                overflow: 'hidden',
                backgroundColor: 'background.muted',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              {auction.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Caixa-hosted photos on hosts we do not control: next/image would route them through our optimizer (SC-24) and needs every host allow-listed
                <img
                  src={auction.imageUrl}
                  alt={auction.title || tCard('property')}
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
                <HomeIcon sx={{ fontSize: 60, mb: 1, opacity: 0.7 }} />
                <Typography variant="body2" color="text.secondary">
                  {tCard('noImage')}
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
                    {t('info')}
                  </Typography>
                </Box>
                {lastPhase && (
                  <Chip label={labels.modality(lastPhase.modality)} color="primary" size="medium" />
                )}
              </Box>

              <Divider sx={{ mb: 3 }} />

              {/* Address */}
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 3 }}>
                <LocationOnIcon sx={{ color: 'primary.main', mt: 0.5 }} />
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    {t('address')}
                  </Typography>
                  <Typography variant="body1">{address || tCard('addressMissing')}</Typography>
                  {auction.address.zipcode && (
                    <Typography variant="body2" color="text.secondary">
                      {t('zipcode', { zipcode: auction.address.zipcode })}
                    </Typography>
                  )}
                </Box>
              </Box>

              {/* Prices */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 3,
                  mb: 3,
                }}
              >
                {auction.appraisalPrice !== null && (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                    <HomeIcon sx={{ color: 'info.main' }} />
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">
                        {tCard('appraisal')}
                      </Typography>
                      <Typography variant="h6" fontWeight={600} color="info.main">
                        <Money value={auction.appraisalPrice} />
                      </Typography>
                    </Box>
                  </Box>
                )}

                {lastPhase?.minimumPrice != null && (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                    <AttachMoneyIcon sx={{ color: 'success.main' }} />
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">
                        {t('currentMinimumBid')}
                      </Typography>
                      <Typography variant="h6" fontWeight={600} color="success.main">
                        <Money value={lastPhase.minimumPrice} />
                      </Typography>
                      {discount !== null && (
                        <Chip
                          label={t('discount', { percent: formatPercent(discount) })}
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
                        {t('auctionDates', { count: lastPhase.phaseDates.length })}
                      </Typography>
                      {lastPhase.phaseDates.map((date, idx, dates) => (
                        <Typography key={idx} variant="body1" fontWeight={600}>
                          {dates.length > 1 ? (
                            t.rich('nthAuctionDate', {
                              position: idx + 1,
                              date: () => <DateText value={date} withTime />,
                            })
                          ) : (
                            <DateText value={date} withTime />
                          )}
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
                        {t('paymentMethods')}
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {lastPhase.paymentMethods.map((method, idx) => (
                          <Chip
                            key={idx}
                            label={labels.paymentMethod(method)}
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
                        {t('expenseRules')}
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {lastPhase.expenseRules.map((rule, idx) => (
                          <Box
                            key={idx}
                            sx={{ backgroundColor: 'background.muted', p: 1.5, borderRadius: 1 }}
                          >
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
                    <DescriptionIcon sx={{ color: 'text.secondary', mt: 0.5 }} />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        {t('documents.title')}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {auction.matriculaUrl && (
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<DownloadIcon />}
                            onClick={() => handleDownloadDocument('matricula')}
                          >
                            {t('documents.matricula')}
                          </Button>
                        )}
                        {auction.editalUrl && (
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<DownloadIcon />}
                            onClick={() => handleDownloadDocument('edital')}
                          >
                            {t('documents.edital')}
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
                    {t('caixaLink')}
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
                  {t('phases.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {tCard('phasesRegistered', { count: auction.phases.length })}
                </Typography>

                <TableContainer component={Paper} variant="outlined">
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>
                          <strong>{t('phases.phase')}</strong>
                        </TableCell>
                        <TableCell>
                          <strong>{t('phases.modality')}</strong>
                        </TableCell>
                        <TableCell align="right">
                          <strong>{tCard('minimumBid')}</strong>
                        </TableCell>
                        <TableCell>
                          <strong>{t('phases.dates')}</strong>
                        </TableCell>
                        <TableCell>
                          <strong>{t('phases.payment')}</strong>
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {auction.phases.map((phase, index) => (
                        <TableRow
                          key={index}
                          sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                        >
                          <TableCell>{t('phases.number', { number: index + 1 })}</TableCell>
                          <TableCell>
                            <Chip
                              label={labels.modality(phase.modality)}
                              size="small"
                              color={index === auction.phases.length - 1 ? 'primary' : 'default'}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Money value={phase.minimumPrice} />
                          </TableCell>
                          <TableCell>
                            {phase.phaseDates && phase.phaseDates.length > 0
                              ? phase.phaseDates.map((d, i) => (
                                  <Box key={i} component="span" sx={{ display: 'block' }}>
                                    <DateText value={d} withTime />
                                  </Box>
                                ))
                              : tCommon('notInformed')}
                          </TableCell>
                          <TableCell>
                            {phase.paymentMethods && phase.paymentMethods.length > 0 ? (
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {phase.paymentMethods.map((method, idx) => (
                                  <Chip
                                    key={idx}
                                    label={labels.paymentMethod(method)}
                                    size="small"
                                    variant="outlined"
                                  />
                                ))}
                              </Box>
                            ) : (
                              <Typography variant="body2" color="text.secondary">
                                {t('phases.noPayment')}
                              </Typography>
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
          {updatedAt && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', textAlign: 'center', mt: 3 }}
            >
              {t.rich('updatedAt', {
                date: () => <DateText value={updatedAt} withTime />,
              })}
            </Typography>
          )}
        </Box>
      </Container>
    </Box>
  );
}
