'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Box,
  Container,
  Typography,
  CircularProgress,
} from '@mui/material';
import { hasMinimumRole } from '@/app/components/RequireRole';
import { useAuth } from '@/app/contexts/AuthContext';
import SearchFilters, { AuctionFilters } from '@/app/components/SearchFilters';
import AuctionList from '@/app/components/AuctionList';
import FavoritesView from '@/app/components/FavoritesView';
import { SavedFiltersProvider } from '@/app/contexts/SavedFiltersContext';
import { shellContentMinHeight } from '@/app/components/patterns/shell-content';

interface SearchResult {
  total: number;
  items: any[];
}

interface QueryReader {
  get(name: string): string | null;
}

// The URL is the source of truth for the search: filters and page are read from it whenever it
// changes (Back/Forward, the AppShell links, a new search), not only on mount.
function filtersFromQuery(query: QueryReader): AuctionFilters {
  const state = query.get('state');
  const city = query.get('city');
  const neighborhood = query.get('neighborhood');
  const modality = query.get('modality');
  const minMargin = query.get('minMargin');
  const maxMargin = query.get('maxMargin');
  return {
    state: state || undefined,
    city: city ? city.split(',') : undefined,
    neighborhood: neighborhood ? neighborhood.split(',') : undefined,
    modality: modality ? modality.split(',') : undefined,
    minMargin: minMargin ? Number(minMargin) : undefined,
    maxMargin: maxMargin ? Number(maxMargin) : undefined,
  };
}

function hasFilters(filters: AuctionFilters): boolean {
  return Boolean(
    filters.state ||
      filters.city?.length ||
      filters.neighborhood?.length ||
      filters.modality?.length ||
      filters.minMargin ||
      filters.maxMargin,
  );
}

function searchQuery(filters: AuctionFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.state) params.set('state', filters.state);
  if (filters.city && filters.city.length > 0) params.set('city', filters.city.join(','));
  if (filters.neighborhood && filters.neighborhood.length > 0) params.set('neighborhood', filters.neighborhood.join(','));
  if (filters.modality && filters.modality.length > 0) params.set('modality', filters.modality.join(','));
  if (filters.minMargin) params.set('minMargin', filters.minMargin.toString());
  if (filters.maxMargin) params.set('maxMargin', filters.maxMargin.toString());
  if (page > 1) params.set('page', page.toString());
  return params.toString();
}

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { role } = useAuth();
  const canAccessFavorites = hasMinimumRole(role, 'standard');
  // #42: the view follows the URL, so the AppShell's Favoritos link (/search?view=favorites) and
  // Buscar imóveis link (/search) switch it without a callback into the page
  const activeView = searchParams.get('view') === 'favorites' && canAccessFavorites ? 'favorites' : 'search';
  const queryKey = searchParams.toString();
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentFilters, setCurrentFilters] = useState<AuctionFilters>({});
  const [pageSize, setPageSize] = useState(10);
  // only the latest search may write results: an older, slower response is dropped
  const searchSequence = useRef(0);

  const performSearch = async (filters: AuctionFilters, page: number) => {
    const sequence = ++searchSequence.current;
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

      if (sequence === searchSequence.current) setSearchResults(data);
    } catch (error: any) {
      if (sequence === searchSequence.current) setSearchResults({ total: 0, items: [] });
    } finally {
      if (sequence === searchSequence.current) setSearchLoading(false);
    }
  };

  // URL → state, on every change of the query. In the favourites view the search state is left
  // alone; back in the search view, a URL with no filters clears the form and the results.
  useEffect(() => {
    if (activeView !== 'search') return;
    const filters = filtersFromQuery(searchParams);
    const pageNum = Number(searchParams.get('page')) || 1;
    setCurrentFilters(filters);
    setCurrentPage(pageNum);
    if (hasFilters(filters)) {
      performSearch(filters, pageNum);
    } else {
      searchSequence.current++;
      setSearchResults(null);
      setSearchLoading(false);
    }
  }, [queryKey, activeView]);

  // state → URL; the effect above then runs the search
  const updateURL = (filters: AuctionFilters, page: number) => {
    const queryString = searchQuery(filters, page);
    router.push(queryString ? `/search?${queryString}` : '/search');
  };

  const handleManualSearch = async (filters: AuctionFilters) => {
    setSearchResults(null);
    if (searchQuery(filters, 1) === queryKey) {
      // the same URL does not change searchParams, so search again directly
      setCurrentFilters(filters);
      setCurrentPage(1);
      await performSearch(filters, 1);
    } else {
      updateURL(filters, 1);
    }
  };

  const handlePageChange = (page: number) => {
    updateURL(currentFilters, page);
    // Scroll to top of results
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePageSizeChange = async (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // Reset to first page when changing page size
    await performSearch(currentFilters, 1);
  };

  return (
    // #42: the AppShell owns the top bar, navigation and <main>; pt no longer offsets a fixed bar
    <Box sx={{ pt: 2, pb: 4, pr: activeView === 'search' ? '380px' : 0, transition: 'padding-right 0.3s' }}>
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
  );
}

function SearchPageLoading() {
  return (
    <Box
      sx={(theme) => ({
        // #42: fills the AppShell content area, not the whole viewport
        ...shellContentMinHeight(theme),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <CircularProgress />
    </Box>
  );
}

export default function SearchPage() {
  return (
    // #42: favourites come from the root FavoritesProvider, shared with the AppShell's count, so a
    // toggle here updates the sidebar pill. (shell)/(authenticated)/layout guards authentication.
    <SavedFiltersProvider>
      <Suspense fallback={<SearchPageLoading />}>
        <SearchPageContent />
      </Suspense>
    </SavedFiltersProvider>
  );
}
