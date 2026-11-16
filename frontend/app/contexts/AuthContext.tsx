'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { apiFetch, apiJson, onSessionEnded } from '@/lib/api-client';
import { reportClientError } from '@/lib/report-client-error';

interface User {
  _id: string;
  email: string;
  name: string;
  providers: string[];
  emailVerified: boolean;
  role: string;
  subscriptionStatus?: string | null;
  phone?: string;
  cpf?: string;
  dateOfBirth?: string;
  sex?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
  emailVerified: boolean;
  role: string;
  hasSubscription: boolean;
  resendVerificationEmail: () => Promise<void>;
  checkVerificationStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // SC-02: there is no token in the browser to read. "Signed in" is whatever `GET /api/auth/me`
  // answers for the session cookie the browser sends by itself.
  const loadUser = useCallback(async () => {
    try {
      const response = await apiFetch('/api/auth/me');
      if (response.ok) {
        // GET /auth/me answers with `userId` (CurrentUserResponseDto), the sign-in answers with
        // `_id` (UserProfileResponseDto): the app keys its per-account state on `_id`.
        const { userId, ...rest }: { userId: string } & Omit<User, '_id'> = await response.json();
        setUser({ ...rest, _id: userId });
      }
      // a 401 UNAUTHENTICATED reaches `onSessionEnded` below; any other failure keeps the user
    } catch (error) {
      reportClientError(error, { where: 'AuthContext.loadUser' });
    } finally {
      setLoading(false);
    }
  }, []);

  // Builds before the cookie session kept the token in localStorage. It is not read any more (and
  // the server refuses old tokens), but it must not sit there for a script to find (SC-02).
  useEffect(() => {
    try {
      window.localStorage.removeItem('token');
    } catch {
      // storage blocked: nothing to remove
    }
  }, []);

  // The session ended anywhere in the app (expired, revoked, signed out elsewhere): drop the user.
  useEffect(() => onSessionEnded(() => setUser(null)), []);

  // Load user on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the session lives in a cookie and the API (external systems); the first read can only happen after mount
    void loadUser();
  }, [loadUser]);

  // The BFF has set the cookie from the backend's token; the answer carries the user only.
  const login = async (email: string, password: string) => {
    const data = await apiJson<{ user: User }>('/api/auth/login', {
      method: 'POST',
      json: { email, password },
    });
    setUser(data.user);
  };

  const register = async (email: string, password: string, name: string) => {
    const data = await apiJson<{ user: User }>('/api/auth/register', {
      method: 'POST',
      json: { email, password, name },
    });
    setUser(data.user);
  };

  const logout = async () => {
    try {
      // the BFF ends the session on the server and always clears the cookie
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      reportClientError(error, { where: 'AuthContext.logout' });
    } finally {
      setUser(null);
    }
  };

  const resendVerificationEmail = async () => {
    await apiJson('/api/auth/resend-verification', { method: 'POST' });
  };

  const checkVerificationStatus = async () => {
    const response = await apiFetch('/api/auth/verification-status');

    if (response.ok) {
      const data = await response.json();
      if (user) {
        const updates: Partial<User> = {};
        if (data.emailVerified !== user.emailVerified) {
          updates.emailVerified = data.emailVerified;
        }
        if (JSON.stringify(data.providers) !== JSON.stringify(user.providers)) {
          updates.providers = data.providers;
        }
        if (Object.keys(updates).length > 0) {
          setUser({ ...user, ...updates });
        }
      }
    }
  };

  const emailVerified = user?.emailVerified ?? false;
  const role = user?.role ?? 'free';
  const hasSubscription = user?.subscriptionStatus === 'active';

  const refreshUser = useCallback(async () => {
    await loadUser();
  }, [loadUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        loadUser,
        refreshUser,
        isAuthenticated: !!user,
        emailVerified,
        role,
        hasSubscription,
        resendVerificationEmail,
        checkVerificationStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
