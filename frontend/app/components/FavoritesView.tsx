'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Box, Pagination, Typography } from '@mui/material';
import { useFavorites } from '../contexts/FavoritesContext';
import type { Auction } from '@/lib/auction';
import { useAuth } from '../contexts/AuthContext';
import AuctionCard from './AuctionCard';
import { readApiError, useApiErrorMessage } from '@/lib/api-error';
import { pageCount, type Paginated } from '@/lib/pagination';
import { reportClientError } from '@/lib/report-client-error';

// AR-35: the favourites list is paginated; this is how many cards one page shows.
const PAGE_SIZE = 20;

export default function FavoritesView() {
  const { favoriteCodes, loading: favoritesLoading, toggleFavorite } = useFavorites();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<Auction> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The cards come from the paginated list; the codes the context holds say when it is stale (a
  // favourite added or removed anywhere), so the page loads again when they change.
  useEffect(() => {
    if (authLoading || !isAuthenticated || favoritesLoading) return;
    let current = true;
    const load = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/favorites?page=${page}&pageSize=${PAGE_SIZE}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw await readApiError(response);
        const body: Paginated<Auction> = await response.json();
        if (!current) return;
        if (body.items.length === 0 && page > 1) {
          // the last favourite of the last page was removed: step back
          setPage(pageCount(body.total, PAGE_SIZE));
          return;
        }
        setError(null);
        setResult(body);
      } catch (err: unknown) {
        if (!current) return;
        reportClientError(err, { where: 'FavoritesView.load' });
        setError(apiErrorMessage(err));
      }
    };
    void load();
    return () => {
      current = false;
    };
  }, [authLoading, isAuthenticated, favoritesLoading, favoriteCodes, page, apiErrorMessage]);

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

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  // the first page has not arrived yet
  if (!result) {
    return null;
  }

  const { items: favorites, total } = result;

  if (total === 0) {
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
          {total} {total === 1 ? 'leilão marcado' : 'leilões marcados'} como{' '}
          {total === 1 ? 'favorito' : 'favoritos'}
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

      {total > PAGE_SIZE && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <Pagination
            count={pageCount(total, PAGE_SIZE)}
            page={page}
            onChange={(_, newPage) => {
              setPage(newPage);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            color="primary"
            size="large"
          />
        </Box>
      )}
    </Box>
  );
}
