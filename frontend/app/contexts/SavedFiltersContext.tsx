'use client';

import { createContext, useCallback, useContext, useState, useEffect, ReactNode } from 'react';
import { ApiError, readApiError } from '@/lib/api-error';
import { fetchAllPages } from '@/lib/pagination';
import { reportClientError } from '@/lib/report-client-error';

export interface FilterData {
  state?: string;
  city?: string[];
  neighborhood?: string[];
  modality?: string[];
  // BRL price bounds as money strings ("50000.00"); the API refuses JSON numbers (AR-17)
  minPrice?: string;
  maxPrice?: string;
}

export interface SavedFilter {
  _id: string;
  name: string;
  filters: FilterData;
  createdAt: string;
  updatedAt: string;
}

interface SavedFiltersContextType {
  savedFilters: SavedFilter[];
  loading: boolean;
  /** The last load failed: `savedFilters` may be missing items (or stale), never a complete list. */
  loadFailed: boolean;
  isAuthenticated: boolean;
  saveFilter: (name: string, filters: FilterData) => Promise<SavedFilter | null>;
  deleteFilter: (id: string) => Promise<boolean>;
  refreshFilters: () => Promise<void>;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

const SavedFiltersContext = createContext<SavedFiltersContextType | undefined>(undefined);

export function SavedFiltersProvider({ children }: { children: ReactNode }) {
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const checkAuthentication = useCallback((): boolean => {
    const token = localStorage.getItem('token');
    const authenticated = !!token;
    setIsAuthenticated(authenticated);
    return authenticated;
  }, []);

  const loadSavedFilters = useCallback(async () => {
    try {
      if (!checkAuthentication()) {
        setLoading(false);
        return;
      }

      setLoadFailed(false);
      // AR-35: the endpoint is paginated and the filter picker needs every filter, so they are
      // read page by page
      setSavedFilters(
        await fetchAllPages<SavedFilter>('/api/saved-filters', { headers: getAuthHeaders() }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSavedFilters([]);
        setIsAuthenticated(false);
      } else {
        setLoadFailed(true);
        reportClientError(error, { where: 'SavedFiltersContext.load' });
      }
    } finally {
      setLoading(false);
    }
  }, [checkAuthentication]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the token lives in storage and the filters in the API (external systems); the first read can only happen after mount
    void loadSavedFilters();
  }, [loadSavedFilters]);

  const saveFilter = async (name: string, filters: FilterData): Promise<SavedFilter | null> => {
    if (!checkAuthentication()) {
      return null;
    }

    try {
      const response = await fetch('/api/saved-filters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ name, filters }),
      });

      if (response.ok) {
        const newFilter = await response.json();
        setSavedFilters((prev) => [newFilter, ...prev]);
        return newFilter;
      } else {
        // AR-39: the caller turns the code (SAVED_FILTER_LIMIT_REACHED, SAVED_FILTER_NAME_TAKEN...)
        // into text
        throw await readApiError(response);
      }
    } catch (error) {
      reportClientError(error, { where: 'SavedFiltersContext.saveFilter' });
      throw error;
    }
  };

  const deleteFilter = async (id: string): Promise<boolean> => {
    if (!checkAuthentication()) {
      return false;
    }

    try {
      const response = await fetch(`/api/saved-filters/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      if (response.ok || response.status === 204) {
        setSavedFilters((prev) => prev.filter((f) => f._id !== id));
        return true;
      } else {
        reportClientError(new Error(`Deleting a filter failed with HTTP ${response.status}`), {
          where: 'SavedFiltersContext.deleteFilter',
        });
        return false;
      }
    } catch (error) {
      reportClientError(error, { where: 'SavedFiltersContext.deleteFilter' });
      return false;
    }
  };

  const refreshFilters = async () => {
    setLoading(true);
    await loadSavedFilters();
  };

  return (
    <SavedFiltersContext.Provider
      value={{
        savedFilters,
        loading,
        loadFailed,
        isAuthenticated,
        saveFilter,
        deleteFilter,
        refreshFilters,
      }}
    >
      {children}
    </SavedFiltersContext.Provider>
  );
}

export function useSavedFilters() {
  const context = useContext(SavedFiltersContext);
  if (context === undefined) {
    throw new Error('useSavedFilters must be used within a SavedFiltersProvider');
  }
  return context;
}
