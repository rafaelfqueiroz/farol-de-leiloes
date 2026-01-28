'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface FilterData {
  state?: string;
  city?: string[];
  neighborhood?: string[];
  modality?: string[];
  minMargin?: number;
  maxMargin?: number;
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
  isAuthenticated: boolean;
  saveFilter: (name: string, filters: FilterData) => Promise<SavedFilter | null>;
  deleteFilter: (id: string) => Promise<boolean>;
  refreshFilters: () => Promise<void>;
}

const SavedFiltersContext = createContext<SavedFiltersContextType | undefined>(undefined);

export function SavedFiltersProvider({ children }: { children: ReactNode }) {
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    loadSavedFilters();
  }, []);

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('token');
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  };

  const checkAuthentication = (): boolean => {
    const token = localStorage.getItem('token');
    const authenticated = !!token;
    setIsAuthenticated(authenticated);
    return authenticated;
  };

  const loadSavedFilters = async () => {
    try {
      if (!checkAuthentication()) {
        setLoading(false);
        return;
      }

      const response = await fetch('/api/saved-filters', {
        headers: getAuthHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        setSavedFilters(data);
      } else if (response.status === 401) {
        setSavedFilters([]);
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('Error loading saved filters:', error);
    } finally {
      setLoading(false);
    }
  };

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
        setSavedFilters(prev => [newFilter, ...prev]);
        return newFilter;
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error saving filter:', response.status, errorData);
        throw new Error(errorData.error || 'Failed to save filter');
      }
    } catch (error) {
      console.error('Error saving filter:', error);
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
        setSavedFilters(prev => prev.filter(f => f._id !== id));
        return true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error deleting filter:', response.status, errorData);
        return false;
      }
    } catch (error) {
      console.error('Error deleting filter:', error);
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
