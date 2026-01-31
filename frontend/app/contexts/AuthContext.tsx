'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface User {
  _id: string;
  email: string;
  name: string;
  provider: string;
  emailVerified: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  isAuthenticated: boolean;
  emailVerified: boolean;
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
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      } else {
        // Token is invalid, clear it
        localStorage.removeItem('token');
      }
    } catch (error) {
      console.error('Error loading user:', error);
      localStorage.removeItem('token');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load user on mount
  useEffect(() => {
    loadUser();
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
      const error = await response.json();
      throw new Error(error.message || 'Login failed');
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
      const error = await response.json();
      throw new Error(error.message || 'Registration failed');
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
            'Authorization': `Bearer ${token}`,
          },
        });
      }
    } catch (error) {
      console.error('Error logging out:', error);
    } finally {
      localStorage.removeItem('token');
      setUser(null);
    }
  };

  const resendVerificationEmail = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to resend verification email');
    }
  };

  const checkVerificationStatus = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const response = await fetch('/api/auth/verification-status', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (user && data.emailVerified !== user.emailVerified) {
        setUser({ ...user, emailVerified: data.emailVerified });
      }
    }
  };

  const emailVerified = user?.emailVerified ?? false;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        loadUser,
        isAuthenticated: !!user,
        emailVerified,
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
