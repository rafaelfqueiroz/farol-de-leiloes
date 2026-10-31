'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Box,
  Container,
  Typography,
  CircularProgress,
} from '@mui/material';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import RequireAuthentication from '../components/RequireAuthentication';
import { hasMinimumRole } from '../components/RequireRole';
import { useAuth } from '../contexts/AuthContext';
import { useSidebar } from '../contexts/SidebarContext';
import SearchFilters, { AuctionFilters } from '../components/SearchFilters';
import AuctionList from '../components/AuctionList';
import FavoritesView from '../components/FavoritesView';
import { FavoritesProvider } from '../contexts/FavoritesContext';
import { SavedFiltersProvider } from '../contexts/SavedFiltersContext';

interface SearchResult {
  total: number;
  items: any[];
}

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { sidebarWidth } = useSidebar();
  const { role } = useAuth();
  const canAccessFavorites = hasMinimumRole(role, 'standard');
  const [activeView, setActiveView] = useState('search');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentFilters, setCurrentFilters] = useState<AuctionFilters>({});
  const [pageSize, setPageSize] = useState(10);

  // Load filters and view from URL on mount
  useEffect(() => {
    const view = searchParams.get('view');
    const state = searchParams.get('state');
    const city = searchParams.get('city');
    const neighborhood = searchParams.get('neighborhood');
    const modality = searchParams.get('modality');
    const minMargin = searchParams.get('minMargin');
    const maxMargin = searchParams.get('maxMargin');
    const page = searchParams.get('page');

    // Check if we should switch to favorites view (Standard+ only)
    if (view === 'favorites' && canAccessFavorites) {
      setActiveView('favorites');
    } else {
      const filters: AuctionFilters = {
        state: state || undefined,
        city: city ? city.split(',') : undefined,
        neighborhood: neighborhood ? neighborhood.split(',') : undefined,
        modality: modality ? modality.split(',') : undefined,
        minMargin: minMargin ? Number(minMargin) : undefined,
        maxMargin: maxMargin ? Number(maxMargin) : undefined,
      };
      const pageNum = page ? Number(page) : 1;

      setCurrentFilters(filters);
      setCurrentPage(pageNum);
      setActiveView('search');

      // Only perform search if there are any filters
      if (state || city || neighborhood || modality || minMargin || maxMargin) {
        performSearch(filters, pageNum);
      }
    }
  }, []);

  const performSearch = async (filters: AuctionFilters, page: number) => {
    setSearchLoading(true);

    try {
      const params = new URLSearchParams();
      if (filters.state) params.set('state', filters.state);
      // Handle city as array - join with comma for API
      if (filters.city && filters.city.length > 0) params.set('city', filters.city.join(','));
      // Handle neighborhood as array - join with comma for API
      if (filters.neighborhood && filters.neighborhood.length > 0) params.set('neighborhood', filters.neighborhood.join(','));
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

  const updateURL = (filters: AuctionFilters, page: number) => {
    const params = new URLSearchParams();
    if (filters.state) params.set('state', filters.state);
    if (filters.city && filters.city.length > 0) params.set('city', filters.city.join(','));
    if (filters.neighborhood && filters.neighborhood.length > 0) params.set('neighborhood', filters.neighborhood.join(','));
    if (filters.modality && filters.modality.length > 0) params.set('modality', filters.modality.join(','));
    if (filters.minMargin) params.set('minMargin', filters.minMargin.toString());
    if (filters.maxMargin) params.set('maxMargin', filters.maxMargin.toString());
    if (page > 1) params.set('page', page.toString());

    const queryString = params.toString();
    router.push(queryString ? `/search?${queryString}` : '/search');
  };

  const handleManualSearch = async (filters: AuctionFilters) => {
    setCurrentFilters(filters);
    setCurrentPage(1);
    setSearchResults(null);
    updateURL(filters, 1);
    await performSearch(filters, 1);
  };

  const handlePageChange = async (page: number) => {
    setCurrentPage(page);
    updateURL(currentFilters, page);
    await performSearch(currentFilters, page);
    // Scroll to top of results
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePageSizeChange = async (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // Reset to first page when changing page size
    await performSearch(currentFilters, 1);
  };

  const handleViewChange = (view: string) => {
    if (view === 'home') {
      router.push('/');
    } else {
      setActiveView(view);
    }
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar activeView={activeView} onViewChange={handleViewChange} />

      <Box sx={{ flexGrow: 1, ml: `${sidebarWidth}px`, transition: 'margin-left 0.3s ease' }}>
        <TopBar />

        <Box component="main" sx={{ pt: 10, pb: 4, pr: activeView === 'search' ? '380px' : 0, transition: 'padding-right 0.3s' }}>
          <Container maxWidth="xl">
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
                      onAISearchResults={(results) => setSearchResults(results)}
                      isLoading={searchLoading}
                      initialFilters={currentFilters}
                    />
                  </Box>
                </Box>
              </>
            )}

            {activeView === 'favorites' && canAccessFavorites && (
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
  );
}

function SearchPageLoading() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <CircularProgress />
    </Box>
  );
}

export default function SearchPage() {
  return (
    <RequireAuthentication>
      <FavoritesProvider>
        <SavedFiltersProvider>
          <Suspense fallback={<SearchPageLoading />}>
            <SearchPageContent />
          </Suspense>
        </SavedFiltersProvider>
      </FavoritesProvider>
    </RequireAuthentication>
  );
}
