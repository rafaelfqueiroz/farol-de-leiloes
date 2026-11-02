'use client';

import { Card, CardContent, Box, Typography, Chip, IconButton } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import ReminderButton from './ReminderButton';

interface Phase {
  modality: string;
  minimumPrice?: number;
  date?: string;
  phaseDates?: string[];
}

interface Address {
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipcode?: string;
}

interface Auction {
  code: string;
  title: string;
  address: Address;
  appraisalPrice?: number;
  phases: Phase[];
  currentPhase?: Phase;
  detailsUrl?: string;
  imageUrl?: string;
  updatedAt?: string;
}

interface AuctionCardProps {
  auction: Auction;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  detailUrl: string;
  showDate?: boolean;
}

const MODALITY_LABELS: Record<string, string> = {
  SFI_AUCTION: 'Leilão SFI',
  OPEN_BIDDING: 'Licitação Aberta',
  DIRECT_ONLINE_SALES: 'Venda Direta Online',
  ONLINE_SALES: 'Venda Online',
};

function formatCurrency(value?: number): string {
  if (!value) return 'N/A';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function getCountdownLabel(currentPhase?: Phase): { text: string; isToday: boolean } | null {
  if (!currentPhase) return null;
  if (currentPhase.modality === 'DIRECT_ONLINE_SALES') return null;

  const phaseDates = currentPhase.phaseDates;
  if (!phaseDates || phaseDates.length === 0) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const futureDates = phaseDates
    .map((d) => new Date(d))
    .filter((d) => d >= today)
    .sort((a, b) => a.getTime() - b.getTime());

  const nearest = futureDates[0];
  if (!nearest) return null;
  const nearestDay = new Date(nearest.getFullYear(), nearest.getMonth(), nearest.getDate());
  const diffMs = nearestDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return { text: 'Hoje', isToday: true };
  if (diffDays === 1) return { text: 'Amanhã', isToday: false };
  return { text: `${diffDays} dias`, isToday: false };
}

function formatAddress(address: Address): string {
  const parts = [address.street, address.neighborhood, address.city, address.state].filter(Boolean);
  return parts.join(', ') || 'Endereço não informado';
}

export default function AuctionCard({
  auction,
  isFavorite,
  onToggleFavorite,
  detailUrl,
  showDate = false,
}: AuctionCardProps) {
  const lastPhase = auction.phases[auction.phases.length - 1];
  const countdown = getCountdownLabel(auction.currentPhase ?? lastPhase);

  return (
    <Card
      sx={{
        transition: 'all 0.3s',
        '&:hover': {
          boxShadow: 4,
          transform: 'translateY(-2px)',
        },
      }}
    >
      {/* Property Image */}
      <Box
        sx={{
          width: '100%',
          height: 200,
          overflow: 'hidden',
          backgroundColor: 'background.muted',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {countdown && (
          <Chip
            label={countdown.text}
            size="small"
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 1,
              fontWeight: 600,
              fontSize: '0.75rem',
              backgroundColor: countdown.isToday ? 'success.soft' : 'background.muted',
              color: countdown.isToday ? 'success.main' : 'text.primary',
            }}
          />
        )}
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
          <HomeIcon sx={{ fontSize: 48, mb: 1, opacity: 0.7 }} />
          <Typography variant="body2" color="text.secondary">
            Sem imagem
          </Typography>
        </Box>
      </Box>

      <CardContent>
        {/* Header with Title, Modality and Actions */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5, fontSize: '1rem' }}>
              {auction.title || 'Imóvel sem título'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Código: {auction.code}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {lastPhase && (
              <Chip
                label={MODALITY_LABELS[lastPhase.modality] || lastPhase.modality}
                size="small"
                color="primary"
              />
            )}
            <IconButton
              onClick={onToggleFavorite}
              size="small"
              sx={{
                color: isFavorite ? 'error.main' : 'action.active',
                '&:hover': {
                  color: 'error.main',
                },
              }}
              title={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
            >
              {isFavorite ? <FavoriteIcon /> : <FavoriteBorderIcon />}
            </IconButton>
            <ReminderButton
              auctionCode={auction.code}
              auctionTitle={auction.title}
              auctionDate={lastPhase?.date}
            />
          </Box>
        </Box>

        {/* Property Details */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <HomeIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.25 }} />
            <Typography variant="body2" color="text.primary">
              {formatAddress(auction.address)}
            </Typography>
          </Box>

          {auction.appraisalPrice && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                💰 Avaliação:
              </Typography>
              <Typography variant="body2" fontWeight={600} color="text.primary">
                {formatCurrency(auction.appraisalPrice)}
              </Typography>
            </Box>
          )}

          {lastPhase?.minimumPrice && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                🏷️ Lance mínimo:
              </Typography>
              <Typography variant="body2" fontWeight={600} color="text.primary">
                {formatCurrency(lastPhase.minimumPrice)}
              </Typography>
            </Box>
          )}

          {showDate && lastPhase?.date && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                📅 Data:
              </Typography>
              <Typography variant="body2" fontWeight={600} color="text.primary">
                {new Date(lastPhase.date).toLocaleDateString('pt-BR')}
              </Typography>
            </Box>
          )}

          {auction.phases.length > 1 && (
            <Typography variant="caption" color="text.secondary">
              📊 {auction.phases.length} fases registradas
            </Typography>
          )}
        </Box>

        {/* Details Link */}
        <Box sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Typography
            component="a"
            href={detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            fontWeight={500}
            sx={{
              color: 'primary.main',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              '&:hover': {
                color: 'primary.dark',
                textDecoration: 'underline',
              },
            }}
          >
            Ver detalhes completos
            <span style={{ fontSize: '0.75rem' }}>↗</span>
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}
