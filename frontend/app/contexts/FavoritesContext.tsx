'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

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

interface FavoritesContextType {
  favorites: Auction[];
  isFavorite: (code: string) => boolean;
  toggleFavorite: (auction: Auction) => void;
  removeFavorite: (code: string) => void;
  loading: boolean;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Load favorites from API on mount
  useEffect(() => {
    loadFavorites();
  }, []);

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('token');
    if (!token) return {};
    return { 'Authorization': `Bearer ${token}` };
  };

  const loadFavorites = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }

      const response = await fetch('/api/favorites', {
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        setFavorites(data);
      } else if (response.status === 401) {
        // Unauthorized - clear favorites
        setFavorites([]);
      }
    } catch (error) {
      console.error('Error loading favorites:', error);
    } finally {
      setLoading(false);
    }
  };

  const isFavorite = (code: string): boolean => {
    return favorites.some(fav => fav.code === code);
  };

  const toggleFavorite = async (auction: Auction) => {
    // Check if user is authenticated
    const token = localStorage.getItem('token');
    console.log('[FavoritesContext] toggleFavorite - Token exists:', !!token);
    if (!token) {
      // Redirect to login if not authenticated
      router.push('/login');
      return;
    }

    const exists = isFavorite(auction.code);

    if (exists) {
      // Remove from favorites
      try {
        const headers = getAuthHeaders();
        console.log('[FavoritesContext] DELETE - Headers:', headers);
        const response = await fetch(`/api/favorites/${auction.code}`, {
          method: 'DELETE',
          headers,
        });
        if (response.ok || response.status === 204) {
          setFavorites(prev => prev.filter(fav => fav.code !== auction.code));
        } else if (response.status === 401) {
          // Token expired or invalid, redirect to login
          localStorage.removeItem('token');
          router.push('/login');
        }
      } catch (error) {
        console.error('Error removing favorite:', error);
      }
    } else {
      // Add to favorites
      try {
        const authHeaders = getAuthHeaders();
        const headers = {
          'Content-Type': 'application/json',
          ...authHeaders,
        };
        console.log('[FavoritesContext] POST - Headers:', headers);
        console.log('[FavoritesContext] POST - Auction:', auction);

        const response = await fetch('/api/favorites', {
          method: 'POST',
          headers,
          body: JSON.stringify(auction),
        });

        console.log('[FavoritesContext] POST - Response status:', response.status);

        if (response.ok) {
          const savedAuction = await response.json();
          setFavorites(prev => [...prev, savedAuction]);
        } else if (response.status === 401) {
          // Token expired or invalid, redirect to login
          localStorage.removeItem('token');
          router.push('/login');
        } else {
          // Log error details for debugging
          const errorData = await response.json().catch(() => ({}));
          console.error('Error adding favorite:', response.status, errorData);
        }
      } catch (error) {
        console.error('Error adding favorite:', error);
      }
    }
  };

  const removeFavorite = async (code: string) => {
    try {
      const response = await fetch(`/api/favorites/${code}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (response.ok || response.status === 204) {
        setFavorites(prev => prev.filter(fav => fav.code !== code));
      }
    } catch (error) {
      console.error('Error removing favorite:', error);
    }
  };

  return (
    <FavoritesContext.Provider value={{ favorites, isFavorite, toggleFavorite, removeFavorite, loading }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (context === undefined) {
    throw new Error('useFavorites must be used within a FavoritesProvider');
  }
  return context;
}
