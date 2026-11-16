'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthContext';
import { useReloadOnUserChange } from './use-reload-on-user-change';
import { apiFetch } from '@/lib/api-client';
import { readApiError } from '@/lib/api-error';
import { reportClientError } from '@/lib/report-client-error';
import type { Auction } from '@/lib/auction';

interface FavoritesContextType {
  /**
   * The code of every favourite, from `GET /favorites/codes` (AR-35): enough for a heart's state
   * and the sidebar count, so the full favourites are never loaded at once. The list page reads
   * the paginated `GET /favorites` itself and reloads when this changes.
   */
  favoriteCodes: string[];
  isFavorite: (code: string) => boolean;
  toggleFavorite: (auction: Auction) => void;
  removeFavorite: (code: string) => void;
  loading: boolean;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favoriteCodes, setFavoriteCodes] = useState<string[]>([]);
  const codeSet = useMemo(() => new Set(favoriteCodes), [favoriteCodes]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  // SC-02: "signed in" is the user AuthContext loaded; the session cookie is not readable here
  const { user } = useAuth();

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
      setLoading(true);
      const response = await apiFetch('/api/favorites/codes');
      if (response.ok) {
        const data: { codes: string[] } = await response.json();
        if (isLatest()) setFavoriteCodes(data.codes);
      } else if (response.status === 401 && isLatest()) {
        // Unauthorized - clear favorites
        setFavoriteCodes([]);
      } else {
        throw await readApiError(response);
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
    setFavoriteCodes([]);
    setLoading(false);
  }, []);

  // #42: fetch once a user is signed in, reload on a change of user, clear on sign-out, so
  // the AppShell's Favoritos count matches the page
  useReloadOnUserChange(loadFavorites, clearFavorites);

  const isFavorite = (code: string): boolean => {
    return codeSet.has(code);
  };

  const toggleFavorite = async (auction: Auction) => {
    // Check if user is authenticated
    if (!user) {
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
        const response = await apiFetch(`/api/favorites/${auction.code}`, { method: 'DELETE' });
        if (!sameAccount()) return; // #42: started by an account that has since signed out
        if (response.ok || response.status === 204) {
          setFavoriteCodes((prev) => prev.filter((code) => code !== auction.code));
        } else if (response.status === 401) {
          // Session ended (apiFetch told the app), redirect to login
          router.push('/login');
        }
      } catch (error) {
        reportClientError(error, { where: 'FavoritesContext.toggleFavorite' });
      }
    } else {
      // Add to favorites
      try {
        const response = await apiFetch('/api/favorites', {
          method: 'POST',
          // AR-34: the API takes the code alone and refuses any other field with a 400
          json: { code: auction.code },
        });

        if (!sameAccount()) return; // #42: started by an account that has since signed out

        if (response.ok) {
          await response.json();
          if (!sameAccount()) return;
          setFavoriteCodes((prev) =>
            prev.includes(auction.code) ? prev : [...prev, auction.code],
          );
        } else if (response.status === 401) {
          // Session ended (apiFetch told the app), redirect to login
          router.push('/login');
        } else {
          reportClientError(await readApiError(response), {
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
      const response = await apiFetch(`/api/favorites/${code}`, { method: 'DELETE' });
      // #42: started by an account that has since signed out
      if (generation !== accountGeneration.current) return;
      if (response.ok || response.status === 204) {
        setFavoriteCodes((prev) => prev.filter((favorite) => favorite !== code));
      }
    } catch (error) {
      reportClientError(error, { where: 'FavoritesContext.removeFavorite' });
    }
  };

  return (
    <FavoritesContext.Provider
      value={{ favoriteCodes, isFavorite, toggleFavorite, removeFavorite, loading }}
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
