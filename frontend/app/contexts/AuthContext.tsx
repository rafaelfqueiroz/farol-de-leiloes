'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ApiError, readApiError } from '@/lib/api-error';
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

  const loadUser = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }

      const response = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        // GET /auth/me answers with `userId` (CurrentUserResponseDto), the sign-in answers with
        // `_id` (UserProfileResponseDto): the app keys its per-account state on `_id`.
        const { userId, ...rest }: { userId: string } & Omit<User, '_id'> = await response.json();
        setUser({ ...rest, _id: userId });
      } else {
        // Token is invalid, clear it
        localStorage.removeItem('token');
      }
    } catch (error) {
      reportClientError(error, { where: 'AuthContext.loadUser' });
      localStorage.removeItem('token');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load user on mount
  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const login = async (email: string, password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      throw await readApiError(response);
    }

    const data = await response.json();
    localStorage.setItem('token', data.accessToken);
    setUser(data.user);
  };

  const register = async (email: string, password: string, name: string) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, name }),
    });

    if (!response.ok) {
      throw await readApiError(response);
    }

    const data = await response.json();
    localStorage.setItem('token', data.accessToken);
    setUser(data.user);
  };

  const logout = async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
    } catch (error) {
      reportClientError(error, { where: 'AuthContext.logout' });
    } finally {
      localStorage.removeItem('token');
      setUser(null);
    }
  };

  const resendVerificationEmail = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      throw new ApiError('UNAUTHENTICATED', {}, 401);
    }

    const response = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw await readApiError(response);
    }
  };

  const checkVerificationStatus = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const response = await fetch('/api/auth/verification-status', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

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
