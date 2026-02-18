'use client';

import { useState } from 'react';
import { Box, Typography, ToggleButtonGroup, ToggleButton, Pagination, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewListIcon from '@mui/icons-material/ViewList';
import { useFavorites } from '../contexts/FavoritesContext';
import AuctionCard from './AuctionCard';

interface Auction {
  code: string;
  title: string;
  address: {
    street?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zipcode?: string;
  };
  appraisalPrice?: number;
  phases: Array<{
    modality: string;
    minimumPrice?: number;
    date?: string;
  }>;
  detailsUrl?: string;
  imageUrl?: string;
  updatedAt?: string;
}

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
  onPageSizeChange
}: AuctionListProps) {
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const totalPages = Math.ceil(total / pageSize);
  const { isFavorite, toggleFavorite } = useFavorites();

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 12 }}>
        <Typography variant="body1" color="text.secondary">
          Carregando leilões...
        </Typography>
      </Box>
    );
  }

  if (auctions.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 12 }}>
        <Box sx={{ fontSize: 60, mb: 2 }}>🔍</Box>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
          Nenhum leilão encontrado
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Tente ajustar os filtros de busca
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Results Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={600} sx={{ mb: 0.5 }}>
            Resultado da busca
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {total.toLocaleString('pt-BR')} resultado{total !== 1 ? 's' : ''}
            {auctions.length < total && ` (mostrando ${auctions.length})`}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="page-size-label">Por página</InputLabel>
            <Select
              labelId="page-size-label"
              value={pageSize}
              label="Por página"
              onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
            >
              <MenuItem value={10}>10</MenuItem>
              <MenuItem value={20}>20</MenuItem>
              <MenuItem value={50}>50</MenuItem>
              <MenuItem value={100}>100</MenuItem>
            </Select>
          </FormControl>

          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, newMode) => newMode && setViewMode(newMode)}
            size="small"
          >
            <ToggleButton value="cards" aria-label="visualização em cards">
              <ViewModuleIcon />
            </ToggleButton>
            <ToggleButton value="list" aria-label="visualização em lista">
              <ViewListIcon />
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* Auction Cards/List */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: viewMode === 'cards' ? 'repeat(auto-fill, minmax(350px, 1fr))' : '1fr' }}>
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
