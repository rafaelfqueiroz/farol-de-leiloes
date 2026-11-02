'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Typography } from '@mui/material';
import { useFavorites, type Auction } from '../contexts/FavoritesContext';
import { useAuth } from '../contexts/AuthContext';
import AuctionCard from './AuctionCard';

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

  // Backend already filters out inactive auctions (unavailable or past date)
  // Only active favorites are returned

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

  const renderAuctionCard = (auction: Auction) => (
    <AuctionCard
      key={auction.code}
      auction={auction}
      isFavorite={true}
      onToggleFavorite={() => toggleFavorite(auction)}
      detailUrl={`/auction/${auction.code}`}
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
          {favorites.length} {favorites.length === 1 ? 'leilão marcado' : 'leilões marcados'} como{' '}
          {favorites.length === 1 ? 'favorito' : 'favoritos'}
        </Typography>
      </Box>

      {/* Active Favorites */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
        }}
      >
        {favorites.map(renderAuctionCard)}
      </Box>
    </Box>
  );
}
