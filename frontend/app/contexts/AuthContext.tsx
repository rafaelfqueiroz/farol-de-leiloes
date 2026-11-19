'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import {
  apiFetch,
  apiJson,
  bumpAuthGeneration,
  currentAuthGeneration,
  onSessionEnded,
} from '@/lib/api-client';
import { reportClientError } from '@/lib/report-client-error';

interface User {
  _id: string;
  email: string;
  name: string;
  providers: string[];
  emailVerified: boolean;
  /** The plan tier until SPEC-012; a legacy `'admin'` is no plan (SPEC-002 BR-002-23). */
  role: string;
  subscriptionStatus?: string | null;
  phone?: string;
  /** SPEC-002 DL-002-05: the admin capability, in the sign-in answer and in /api/auth/me. */
  isAdmin?: boolean;
  /** SPEC-002 BR-002-14: derived by the server on each /api/auth/me; absent in a sign-in answer. */
  personas?: string[];
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
  /**
   * SPEC-002: capability flags for what the interface shows. UX only; the server checks every
   * request on its own (AR-51, BR-002-10).
   */
  isAdmin: boolean;
  personas: string[];
  hasSubscription: boolean;
  resendVerificationEmail: () => Promise<void>;
  checkVerificationStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // The newest lookup; an older one that is still in flight has been superseded.
  const lookups = useRef(0);

  // SC-02: there is no token in the browser to read. "Signed in" is whatever `GET /api/auth/me`
  // answers for the session cookie the browser sends by itself.
  //
  // BR-001-18: a lookup starts a new auth generation, so the answers of earlier calls are stale
  // from here on. Its own answer is stale, and ignored (the user is neither set nor cleared), when
  // the session changed while it was in flight (a sign-in during the first visit's lookup, which
  // would otherwise be undone by the lookup's anonymous answer) or a newer lookup started.
  const loadUser = useCallback(async () => {
    const lookup = ++lookups.current;
    bumpAuthGeneration();
    const generation = currentAuthGeneration();
    try {
      const response = await apiFetch('/api/auth/me');
      if (currentAuthGeneration() !== generation || lookups.current !== lookup) return;
      if (response.ok) {
        // GET /auth/me answers with `userId` (CurrentUserResponseDto), the sign-in answers with
        // `_id` (UserProfileResponseDto): the app keys its per-account state on `_id`.
        const { userId, ...rest }: { userId: string } & Omit<User, '_id'> = await response.json();
        if (currentAuthGeneration() !== generation || lookups.current !== lookup) return;
        setUser({ ...rest, _id: userId });
      }
      // a 401 UNAUTHENTICATED reaches `onSessionEnded` below; any other failure keeps the user
    } catch (error) {
      reportClientError(error, { where: 'AuthContext.loadUser' });
    } finally {
      // a superseded lookup leaves `loading` to the newer one
      if (lookups.current === lookup) setLoading(false);
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
  // Answers of calls made under that session are stale from now on.
  useEffect(
    () =>
      onSessionEnded(() => {
        bumpAuthGeneration();
        setUser(null);
      }),
    [],
  );

  // Load user on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the session lives in a cookie and the API (external systems); the first read can only happen after mount
    void loadUser();
  }, [loadUser]);

  // The sign-in and registration answers carry the profile only: no `personas`, which the server
  // derives on each GET /api/auth/me (SPEC-002 BR-002-14). The pages decide what to offer from them
  // (an office member's plan, the navigation, the billing notice), so they are read BEFORE the
  // sign-in resolves and the caller navigates; a failed read leaves the profile as the answer had it.
  // It does not start a new session lookup (no generation bump, no loading): it asks /me once and
  // merges the two capability fields, and only if the session it was asked under is still current.
  const readCapabilities = async (profile: User) => {
    const generation = currentAuthGeneration();
    try {
      const response = await apiFetch('/api/auth/me');
      if (!response.ok) return;
      const me: { isAdmin?: boolean; personas?: string[] } = await response.json();
      if (currentAuthGeneration() !== generation) return;
      setUser((current) =>
        current?._id === profile._id
          ? {
              ...current,
              ...(Array.isArray(me.personas) ? { personas: me.personas } : {}),
              ...(typeof me.isAdmin === 'boolean' ? { isAdmin: me.isAdmin } : {}),
            }
          : current,
      );
    } catch (error) {
      reportClientError(error, { where: 'AuthContext.readCapabilities' });
    }
  };

  // The BFF has set the cookie from the backend's token; the answer carries the user only.
  const login = async (email: string, password: string) => {
    const data = await apiJson<{ user: User }>('/api/auth/login', {
      method: 'POST',
      json: { email, password },
    });
    bumpAuthGeneration(); // BR-001-18: calls started before this sign-in are stale now
    setUser(data.user);
    await readCapabilities(data.user);
  };

  const register = async (email: string, password: string, name: string) => {
    const data = await apiJson<{ user: User }>('/api/auth/register', {
      method: 'POST',
      // BR-001-02: the form only submits once the terms are accepted
      json: { email, password, name, acceptTerms: true },
    });
    bumpAuthGeneration(); // BR-001-18: calls started before this registration are stale now
    setUser(data.user);
    await readCapabilities(data.user);
  };

  const logout = async () => {
    try {
      // the BFF ends the session on the server and always clears the cookie
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      reportClientError(error, { where: 'AuthContext.logout' });
    } finally {
      bumpAuthGeneration(); // BR-001-18: calls started under the ended session are stale now
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
  const isAdmin = user?.isAdmin === true;
  const personas = user?.personas ?? [];
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
        isAdmin,
        personas,
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
