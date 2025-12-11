'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Typography, Divider } from '@mui/material';
import { useFavorites } from '../contexts/FavoritesContext';
import { useAuth } from '../contexts/AuthContext';
import AuctionCard from './AuctionCard';

export default function FavoritesView() {
  const { favorites, toggleFavorite } = useFavorites();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();

  // Navigate to detail with return URL to favorites page
  const navigateToDetail = (code: string) => {
    const returnUrl = encodeURIComponent('/?view=favorites');
    router.push(`/auction/${code}?returnUrl=${returnUrl}`);
  };

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

  const renderAuctionCard = (auction: any) => (
    <AuctionCard
      key={auction.code}
      auction={auction}
      isFavorite={true}
      onToggleFavorite={() => toggleFavorite(auction)}
      onNavigateToDetail={() => navigateToDetail(auction.code)}
      showDate={true}
    />
  );

  return (
    <Box>
      {/* Page Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={600} sx={{ mb: 1 }}>
          Leilões Favoritos
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {favorites.length} {favorites.length === 1 ? 'leilão marcado' : 'leilões marcados'} como {favorites.length === 1 ? 'favorito' : 'favoritos'}
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
