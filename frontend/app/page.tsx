'use client';

import { useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Button,
  ThemeProvider,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import SearchFilters, { AuctionFilters } from './components/SearchFilters';
import AuctionList from './components/AuctionList';
import FavoritesView from './components/FavoritesView';
import { FavoritesProvider } from './contexts/FavoritesContext';
import theme from './theme';

interface SearchResult {
  total: number;
  items: any[];
}

export default function Home() {
  const [activeView, setActiveView] = useState('home');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentFilters, setCurrentFilters] = useState<AuctionFilters>({});
  const [pageSize, setPageSize] = useState(10);

  const performSearch = async (filters: AuctionFilters, page: number) => {
    setSearchLoading(true);

    try {
      const params = new URLSearchParams();
      if (filters.state) params.set('state', filters.state);
      // Handle city as array - join with comma for API
      if (filters.city && filters.city.length > 0) params.set('city', filters.city.join(','));
      if (filters.neighborhood) params.set('neighborhood', filters.neighborhood);
      // Handle modality as array - join with comma for API
      if (filters.modality && filters.modality.length > 0) params.set('modality', filters.modality.join(','));
      if (filters.minMargin) params.set('minMargin', filters.minMargin.toString());
      if (filters.maxMargin) params.set('maxMargin', filters.maxMargin.toString());
      params.set('limit', pageSize.toString());
      params.set('offset', ((page - 1) * pageSize).toString());

      const response = await fetch(`/api/search?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch auctions');

      setSearchResults(data);
    } catch (error: any) {
      setSearchResults({ total: 0, items: [] });
    } finally {
      setSearchLoading(false);
    }
  };

  const handleManualSearch = async (filters: AuctionFilters) => {
    setCurrentFilters(filters);
    setCurrentPage(1);
    setSearchResults(null);
    await performSearch(filters, 1);
  };

  const handlePageChange = async (page: number) => {
    setCurrentPage(page);
    await performSearch(currentFilters, page);
    // Scroll to top of results
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePageSizeChange = async (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // Reset to first page when changing page size
    await performSearch(currentFilters, 1);
  };

  return (
    <ThemeProvider theme={theme}>
      <FavoritesProvider>
        <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: '#FAFAF9' }}>
          <Sidebar activeView={activeView} onViewChange={setActiveView} />

          <Box sx={{ flexGrow: 1, ml: '72px' }}>
            <TopBar userName="Rafael Queiroz" userInitials="RQ" />

            <Box component="main" sx={{ pt: 10, pb: 4, pr: activeView === 'search' ? '380px' : 0, transition: 'padding-right 0.3s' }}>
              <Container maxWidth="xl">
                {activeView === 'home' && (
                  <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    <Card sx={{ textAlign: 'center', maxWidth: 500, width: '100%' }}>
                      <CardContent sx={{ py: 6, px: 4 }}>
                        <Box sx={{ fontSize: 48, mb: 2 }}>🏦</Box>
                        <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
                          Busca Imóveis Caixa
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
                          Imóveis exclusivos da Caixa Econômica Federal
                        </Typography>
                        <Button
                          variant="contained"
                          color="primary"
                          fullWidth
                          size="large"
                          startIcon={<SearchIcon />}
                          onClick={() => setActiveView('search')}
                        >
                          Buscar
                        </Button>
                      </CardContent>
                    </Card>
                  </Box>
                )}

                {activeView === 'search' && (
                  <>
                    {/* Search Header */}
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="h4" fontWeight={600} sx={{ mb: 1 }}>
                        Busca de Imóveis
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Encontre as melhores oportunidades de imóveis de leilões da Caixa Econômica Federal
                      </Typography>
                    </Box>

                    {/* Main Search Layout */}
                    <Box sx={{ display: 'flex', gap: 3, position: 'relative' }}>
                      {/* Center Content - AI Search */}
                      <Box sx={{ flex: 1 }}>
                        <SearchFilters
                          onSearch={handleManualSearch}
                          isLoading={searchLoading}
                        />
                      </Box>
                    </Box>
                  </>
                )}

                {activeView === 'favorites' && (
                  <FavoritesView />
                )}

                {/* Search Results */}
                {searchResults && activeView === 'search' && (
                  <Box sx={{ mt: 4 }}>
                    <AuctionList
                      auctions={searchResults.items}
                      total={searchResults.total}
                      isLoading={searchLoading}
                      page={currentPage}
                      pageSize={pageSize}
                      onPageChange={handlePageChange}
                      onPageSizeChange={handlePageSizeChange}
                    />
                  </Box>
                )}
              </Container>
            </Box>
          </Box>
        </Box>
      </FavoritesProvider>
    </ThemeProvider>
  );
}
