'use client';

import { createContext, useCallback, useContext, useRef, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useReloadOnUserChange } from './use-reload-on-user-change';
import { reportClientError } from '@/lib/report-client-error';

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
  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('token');
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  };

  // #42: only the latest load (or clear) may write, so a slow response for a previous user
  // cannot overwrite the current one's favourites
  const latestRequest = useRef(0);
  // #42: bumped on every account change (sign-out, another user). A mutation started under an
  // older generation must not touch state: its response belongs to the previous account.
  const accountGeneration = useRef(0);

  const loadFavorites = useCallback(async () => {
    const request = ++latestRequest.current;
    const isLatest = () => request === latestRequest.current;
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setFavorites([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const response = await fetch('/api/favorites', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        if (isLatest()) setFavorites(data);
      } else if (response.status === 401 && isLatest()) {
        // Unauthorized - clear favorites
        setFavorites([]);
      }
    } catch (error) {
      if (isLatest()) reportClientError(error, { where: 'FavoritesContext.load' });
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, []);

  const clearFavorites = useCallback(() => {
    latestRequest.current++;
    accountGeneration.current++;
    setFavorites([]);
    setLoading(false);
  }, []);

  // #42: fetch at once when a token exists, reload on a change of user, clear on sign-out, so
  // the AppShell's Favoritos count matches the page
  useReloadOnUserChange(loadFavorites, clearFavorites);

  const isFavorite = (code: string): boolean => {
    return favorites.some((fav) => fav.code === code);
  };

  const toggleFavorite = async (auction: Auction) => {
    // Check if user is authenticated
    const token = localStorage.getItem('token');
    if (!token) {
      // Redirect to login if not authenticated
      router.push('/login');
      return;
    }

    const exists = isFavorite(auction.code);
    const generation = accountGeneration.current;
    const sameAccount = () => generation === accountGeneration.current;

    if (exists) {
      // Remove from favorites
      try {
        const headers = getAuthHeaders();
        const response = await fetch(`/api/favorites/${auction.code}`, {
          method: 'DELETE',
          headers,
        });
        if (!sameAccount()) return; // #42: started by an account that has since signed out
        if (response.ok || response.status === 204) {
          setFavorites((prev) => prev.filter((fav) => fav.code !== auction.code));
        } else if (response.status === 401) {
          // Token expired or invalid, redirect to login
          localStorage.removeItem('token');
          router.push('/login');
        }
      } catch (error) {
        reportClientError(error, { where: 'FavoritesContext.toggleFavorite' });
      }
    } else {
      // Add to favorites
      try {
        const authHeaders = getAuthHeaders();
        const headers = {
          'Content-Type': 'application/json',
          ...authHeaders,
        };

        const response = await fetch('/api/favorites', {
          method: 'POST',
          headers,
          body: JSON.stringify(auction),
        });

        if (!sameAccount()) return; // #42: started by an account that has since signed out

        if (response.ok) {
          const savedAuction = await response.json();
          if (!sameAccount()) return;
          setFavorites((prev) => [...prev, savedAuction]);
        } else if (response.status === 401) {
          // Token expired or invalid, redirect to login
          localStorage.removeItem('token');
          router.push('/login');
        } else {
          reportClientError(new Error(`Adding a favorite failed with HTTP ${response.status}`), {
            where: 'FavoritesContext.toggleFavorite',
          });
        }
      } catch (error) {
        reportClientError(error, { where: 'FavoritesContext.toggleFavorite' });
      }
    }
  };

  const removeFavorite = async (code: string) => {
    const generation = accountGeneration.current;
    try {
      const response = await fetch(`/api/favorites/${code}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      // #42: started by an account that has since signed out
      if (generation !== accountGeneration.current) return;
      if (response.ok || response.status === 204) {
        setFavorites((prev) => prev.filter((fav) => fav.code !== code));
      }
    } catch (error) {
      reportClientError(error, { where: 'FavoritesContext.removeFavorite' });
    }
  };

  return (
    <FavoritesContext.Provider
      value={{ favorites, isFavorite, toggleFavorite, removeFavorite, loading }}
    >
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
