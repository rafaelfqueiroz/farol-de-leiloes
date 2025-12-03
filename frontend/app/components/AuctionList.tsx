'use client';

import { useState } from 'react';
import { Box, Typography, ToggleButtonGroup, ToggleButton, Card, CardContent, Chip, Pagination, Select, MenuItem, FormControl, InputLabel, IconButton } from '@mui/material';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewListIcon from '@mui/icons-material/ViewList';
import HomeIcon from '@mui/icons-material/Home';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import { useFavorites } from '../contexts/FavoritesContext';

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

function formatAddress(address: Auction['address']): string {
  const parts = [
    address.street,
    address.neighborhood,
    address.city,
    address.state,
  ].filter(Boolean);
  return parts.join(', ') || 'Endereço não informado';
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
        {auctions.map((auction) => {
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
                        color: isFavorite(auction.code) ? 'error.main' : 'action.active',
                        '&:hover': {
                          color: 'error.main',
                        },
                      }}
                    >
                      {isFavorite(auction.code) ? <FavoriteIcon /> : <FavoriteBorderIcon />}
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
        })}
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
