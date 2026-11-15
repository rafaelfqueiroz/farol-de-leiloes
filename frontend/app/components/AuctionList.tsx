'use client';

import { useState } from 'react';
import {
  Box,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Pagination,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import { useTranslations } from 'next-intl';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewListIcon from '@mui/icons-material/ViewList';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { useFavorites } from '../contexts/FavoritesContext';
import type { Auction } from '@/lib/auction';
import { formatCount } from '@/lib/numbers';
import AuctionCard from './AuctionCard';
import EmptyState from './patterns/EmptyState';

const PAGE_SIZES = [10, 20, 50, 100] as const;

interface AuctionListProps {
  auctions: Auction[];
  total: number;
  isLoading?: boolean;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

export default function AuctionList({
  auctions,
  total,
  isLoading = false,
  page = 1,
  pageSize = 10,
  onPageChange,
  onPageSizeChange,
}: AuctionListProps) {
  const t = useTranslations('auctionList');
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const totalPages = Math.ceil(total / pageSize);
  const { isFavorite, toggleFavorite } = useFavorites();

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 12 }}>
        <Typography variant="body1" color="text.secondary">
          {t('loading')}
        </Typography>
      </Box>
    );
  }

  if (auctions.length === 0) {
    return (
      <EmptyState icon={SearchOutlined} title={t('emptyTitle')} description={t('emptyHint')} />
    );
  }

  return (
    <Box>
      {/* Results Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h3" component="h2" sx={{ mb: 0.5 }}>
            {t('title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {auctions.length < total
              ? t('resultsShowing', {
                  count: total,
                  formatted: formatCount(total),
                  shown: formatCount(auctions.length),
                })
              : t('results', { count: total, formatted: formatCount(total) })}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <FormControl size="small" sx={{ minWidth: (theme) => theme.spacing(15) }}>
            <InputLabel id="page-size-label">{t('perPage')}</InputLabel>
            <Select
              labelId="page-size-label"
              value={pageSize}
              label={t('perPage')}
              onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
            >
              {PAGE_SIZES.map((size) => (
                <MenuItem key={size} value={size}>
                  {formatCount(size)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, newMode) => newMode && setViewMode(newMode)}
            size="small"
          >
            <ToggleButton value="cards" aria-label={t('viewCards')}>
              <ViewModuleIcon />
            </ToggleButton>
            <ToggleButton value="list" aria-label={t('viewList')}>
              <ViewListIcon />
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* Auction Cards/List */}
      <Box
        sx={(theme) => ({
          display: 'grid',
          gap: 2,
          gridTemplateColumns:
            viewMode === 'cards' ? `repeat(auto-fill, minmax(${theme.spacing(44)}, 1fr))` : '1fr',
        })}
      >
        {auctions.map((auction) => (
          <AuctionCard
            key={auction.code}
            auction={auction}
            isFavorite={isFavorite(auction.code)}
            onToggleFavorite={() => toggleFavorite(auction)}
            detailUrl={`/auction/${auction.code}`}
          />
        ))}
      </Box>

      {/* Pagination */}
      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, newPage) => onPageChange?.(newPage)}
            color="primary"
            size="large"
            showFirstButton
            showLastButton
          />
        </Box>
      )}
    </Box>
  );
}
