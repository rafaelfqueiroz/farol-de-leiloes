'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Box, Button, Pagination } from '@mui/material';
import FavoriteBorderOutlined from '@mui/icons-material/FavoriteBorderOutlined';
import { useTranslations } from 'next-intl';
import { useFavorites } from '../contexts/FavoritesContext';
import type { Auction } from '@/lib/auction';
import { useAuth } from '../contexts/AuthContext';
import AuctionCard from './AuctionCard';
import EmptyState from './patterns/EmptyState';
import ErrorState from './patterns/ErrorState';
import PageHeader from './patterns/PageHeader';
import { readApiError, useApiErrorMessage } from '@/lib/api-error';
import { formatCount } from '@/lib/numbers';
import { pageCount, type Paginated } from '@/lib/pagination';
import { reportClientError } from '@/lib/report-client-error';

// AR-35: the favourites list is paginated; this is how many cards one page shows.
const PAGE_SIZE = 20;

export default function FavoritesView() {
  const t = useTranslations('favorites');
  const tLoadFailed = useTranslations('loadFailed.favorites');
  const { favoriteCodes, loading: favoritesLoading, toggleFavorite } = useFavorites();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<Auction> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // bumped by the error state's retry, which loads the list again
  const [attempt, setAttempt] = useState(0);

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
  }, [
    authLoading,
    isAuthenticated,
    favoritesLoading,
    favoriteCodes,
    page,
    attempt,
    apiErrorMessage,
  ]);

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

  // DS-15: the view owns the page's h1 in every state, so the page has one h1 while the list loads
  // and when it fails
  if (error) {
    return (
      <>
        <PageHeader title={t('title')} />
        <ErrorState
          title={tLoadFailed('title')}
          message={error}
          onRetry={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      </>
    );
  }

  // the first page has not arrived yet
  if (!result) {
    return <PageHeader title={t('title')} />;
  }

  const { items: favorites, total } = result;

  if (total === 0) {
    return (
      <>
        <PageHeader title={t('title')} summary={t('emptySummary')} />
        <EmptyState
          icon={FavoriteBorderOutlined}
          title={t('emptyTitle')}
          description={t('emptyHint')}
          actions={
            <Button component={Link} href="/search" variant="outlined">
              {t('emptyAction')}
            </Button>
          }
        />
      </>
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
    <>
      <PageHeader
        title={t('title')}
        summary={t('summary', { count: total, formatted: formatCount(total) })}
      />

      {/* Active Favorites */}
      <Box
        sx={(theme) => ({
          display: 'grid',
          gap: 2,
          gridTemplateColumns: `repeat(auto-fill, minmax(${theme.spacing(44)}, 1fr))`,
        })}
      >
        {favorites.map(renderAuctionCard)}
      </Box>

      {total > PAGE_SIZE && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
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
    </>
  );
}
