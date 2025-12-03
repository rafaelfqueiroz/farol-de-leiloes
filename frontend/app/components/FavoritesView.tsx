'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Typography, Card, CardContent, Chip, IconButton, Divider } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import FavoriteIcon from '@mui/icons-material/Favorite';
import { useFavorites } from '../contexts/FavoritesContext';
import { useAuth } from '../contexts/AuthContext';

const MODALITY_LABELS: Record<string, string> = {
  FIRST_AUCTION: 'Primeiro Leilão',
  SECOND_AUCTION: 'Segundo Leilão',
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

function formatAddress(address: any): string {
  const parts = [
    address.street,
    address.neighborhood,
    address.city,
    address.state,
  ].filter(Boolean);
  return parts.join(', ') || 'Endereço não informado';
}

export default function FavoritesView() {
  const { favorites, toggleFavorite } = useFavorites();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);

  // Show nothing while checking authentication
  if (authLoading || !isAuthenticated) {
    return null;
  }

  // Split favorites into upcoming and old based on current date
  const now = new Date();
  const upcoming = favorites.filter(auction => {
    const lastPhase = auction.phases[auction.phases.length - 1];
    if (!lastPhase.date) return false;
    return new Date(lastPhase.date) >= now;
  });

  const old = favorites.filter(auction => {
    const lastPhase = auction.phases[auction.phases.length - 1];
    if (!lastPhase.date) return true;
    return new Date(lastPhase.date) < now;
  });

  if (favorites.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 12 }}>
        <Box sx={{ fontSize: 60, mb: 2 }}>💔</Box>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
          Nenhum leilão favorito
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Marque leilões como favoritos para acompanhá-los aqui
        </Typography>
      </Box>
    );
  }

  const renderAuctionCard = (auction: any) => {
    const lastPhase = auction.phases[auction.phases.length - 1];

    return (
      <Card
        key={auction.code}
        sx={{
          transition: 'all 0.3s',
          '&:hover': {
            boxShadow: 4,
            transform: 'translateY(-2px)',
          },
        }}
      >
        <CardContent>
          {/* Header with Title, Modality and Favorite */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
            <Box sx={{ flex: 1, pr: 2 }}>
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
                onClick={() => toggleFavorite(auction)}
                size="small"
                sx={{
                  color: 'error.main',
                  '&:hover': {
                    color: 'error.dark',
                  },
                }}
              >
                <FavoriteIcon />
              </IconButton>
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

            {lastPhase?.date && (
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
          {auction.detailsUrl && (
            <Box sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}>
              <Typography
                component="a"
                href={auction.detailsUrl}
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
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <Box>
      {/* Page Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={600} sx={{ mb: 1 }}>
          Leilões Favoritos
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {favorites.length} leilão{favorites.length !== 1 ? 'ões' : ''} marcado{favorites.length !== 1 ? 's' : ''} como favorito{favorites.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      {/* Upcoming Auctions */}
      {upcoming.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
            Próximos Leilões ({upcoming.length})
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))' }}>
            {upcoming.map(renderAuctionCard)}
          </Box>
        </Box>
      )}

      {upcoming.length > 0 && old.length > 0 && <Divider sx={{ my: 4 }} />}

      {/* Old Auctions */}
      {old.length > 0 && (
        <Box>
          <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
            Leilões Encerrados ({old.length})
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))' }}>
            {old.map(renderAuctionCard)}
          </Box>
        </Box>
      )}
    </Box>
  );
}
