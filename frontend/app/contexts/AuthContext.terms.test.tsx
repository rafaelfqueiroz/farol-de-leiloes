import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import { AuthProvider, useAuth } from './AuthContext';

// SPEC-010 BR-010-05, BR-010-27: the account's terms state comes from /api/auth/me, from the sign-in
// that reads it right after, and from any call the API refuses with TERMS_ACCEPTANCE_REQUIRED.
// Real provider, real API client; only `fetch` is stubbed.
vi.mock('@/lib/report-client-error', () => ({ reportClientError: vi.fn() }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ME = {
  userId: 'u1',
  email: 'ana@example.test',
  name: 'Ana',
  providers: ['local'],
  emailVerified: true,
  role: 'free',
  isAdmin: false,
  personas: ['searcher'],
  termsAcceptanceRequired: false,
  documents: [],
  whatsappPromptPending: false,
};

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

let me: Record<string, unknown>;
let requests: string[];

beforeEach(() => {
  me = { ...ME };
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/auth/me') return json(me);
      if (url === '/api/auth/login' || url === '/api/auth/register') {
        return json({ user: { _id: 'u1', email: 'ana@example.test', name: 'Ana' } }, 201);
      }
      if (url === '/api/favorites') {
        return json({ code: 'TERMS_ACCEPTANCE_REQUIRED', context: {} }, 403);
      }
      return json({}, 200);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('AuthProvider and the documents to accept', () => {
  it('keeps what /api/auth/me says: the documents still to accept and the pending WhatsApp question', async () => {
    me = {
      ...ME,
      termsAcceptanceRequired: true,
      documents: [{ type: 'terms', version: '0.2' }],
      whatsappPromptPending: true,
    };
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.user?.termsAcceptanceRequired).toBe(true));
    expect(result.current.user?.documents).toEqual([{ type: 'terms', version: '0.2' }]);
    expect(result.current.user?.whatsappPromptPending).toBe(true);
  });

  it('a sign-in under a pending version reads the state right after it, so the dialog opens at once', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    me = { ...ME, termsAcceptanceRequired: true, documents: [{ type: 'privacy', version: '0.3' }] };

    await act(() => result.current.login('ana@example.test', 'x'));

    expect(result.current.user?.termsAcceptanceRequired).toBe(true);
    expect(result.current.user?.documents).toEqual([{ type: 'privacy', version: '0.3' }]);
  });

  it('any call answered TERMS_ACCEPTANCE_REQUIRED sets the flag at once and then reads which documents', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(result.current.user?.termsAcceptanceRequired).toBe(false);
    me = { ...ME, termsAcceptanceRequired: true, documents: [{ type: 'terms', version: '0.2' }] };

    await act(async () => {
      await apiFetch('/api/favorites');
    });

    await waitFor(() =>
      expect(result.current.user?.documents).toEqual([{ type: 'terms', version: '0.2' }]),
    );
    expect(result.current.user?.termsAcceptanceRequired).toBe(true);
    expect(requests.filter((request) => request === 'GET /api/auth/me')).toHaveLength(2);
  });

  it('keeps the flag, with no documents, when /api/auth/me cannot be read after the refusal', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).not.toBeNull());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/favorites'
          ? json({ code: 'TERMS_ACCEPTANCE_REQUIRED', context: {} }, 403)
          : json({ code: 'BACKEND_UNAVAILABLE', context: {} }, 502),
      ),
    );

    await act(async () => {
      await apiFetch('/api/favorites');
    });

    expect(result.current.user?.termsAcceptanceRequired).toBe(true);
  });

  it('does nothing for a refusal when nobody is signed in', async () => {
    me = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/auth/me'
          ? json({ code: 'UNAUTHENTICATED', context: {} }, 401)
          : json({ code: 'TERMS_ACCEPTANCE_REQUIRED', context: {} }, 403),
      ),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await apiFetch('/api/favorites');
    });

    expect(result.current.user).toBeNull();
  });

  it('BR-010-01, BR-010-27: registration sends the versions shown and the WhatsApp choice with acceptTerms', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() =>
      result.current.register('ana@example.test', 'secret-one', 'Ana', {
        termsVersion: '0.2',
        privacyVersion: '0.2',
        whatsappConsent: true,
      }),
    );

    const fetchMock = vi.mocked(fetch);
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/auth/register');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      email: 'ana@example.test',
      password: 'secret-one',
      name: 'Ana',
      acceptTerms: true,
      termsVersion: '0.2',
      privacyVersion: '0.2',
      whatsappConsent: true,
    });
  });
});
