import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-error';
import {
  apiFetch,
  apiJson,
  bumpAuthGeneration,
  currentAuthGeneration,
  onSessionEnded,
} from './api-client';

// SC-02: browser code calls the same-origin BFF with the session cookie and never builds an
// Authorization header; a 401 UNAUTHENTICATED is the one global "session ended" signal.
const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiFetch', () => {
  it('sends the cookie with a same-origin request and no Authorization header', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(answer({}));

    await apiFetch('/api/auth/me');

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', { credentials: 'same-origin' });
  });

  it('serialises `json` as the body with its content type', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(answer({}));

    await apiFetch('/api/favorites', { method: 'POST', json: { code: 'A1' } });

    expect(fetchMock).toHaveBeenCalledWith('/api/favorites', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{"code":"A1"}',
    });
  });

  it('returns the raw response so a caller can branch on its status', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(answer({ code: 'NOT_FOUND', context: {} }, 404));

    const response = await apiFetch('/api/x');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'NOT_FOUND', context: {} });
  });

  it('tells the app the session ended on a 401 UNAUTHENTICATED, and still returns the body', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(answer({ code: 'UNAUTHENTICATED', context: {} }, 401));
    const ended = vi.fn();
    const unsubscribe = onSessionEnded(ended);

    const response = await apiFetch('/api/favorites');

    expect(ended).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ code: 'UNAUTHENTICATED', context: {} });
    unsubscribe();
  });

  it('does not treat another 401 as a dead session (wrong password)', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(answer({ code: 'INVALID_CREDENTIALS', context: {} }, 401));
    const ended = vi.fn();
    const unsubscribe = onSessionEnded(ended);

    await apiFetch('/api/auth/login', { method: 'POST', json: {} });

    expect(ended).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('does not treat a 401 whose body is not an API body as a dead session', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response('<html>', { status: 401 }));
    const ended = vi.fn();
    const unsubscribe = onSessionEnded(ended);

    await apiFetch('/api/x');

    expect(ended).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('stops notifying a listener once it unsubscribed', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async () => answer({ code: 'UNAUTHENTICATED', context: {} }, 401));
    const ended = vi.fn();
    onSessionEnded(ended)();

    await apiFetch('/api/x');

    expect(ended).not.toHaveBeenCalled();
  });

  it('lets a network failure reject to the caller', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiFetch('/api/x')).rejects.toThrow('Failed to fetch');
  });
});

describe('the auth generation (BR-001-18)', () => {
  it('counts the session changes it is told about', () => {
    const before = currentAuthGeneration();

    bumpAuthGeneration();

    expect(currentAuthGeneration()).toBe(before + 1);
  });

  it('ignores a 401 UNAUTHENTICATED whose request started under an older generation, and still returns it', async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    const ended = vi.fn();
    const unsubscribe = onSessionEnded(ended);

    const call = apiFetch('/api/favorites');
    bumpAuthGeneration(); // a sign-in happened while the call was in flight
    release(answer({ code: 'UNAUTHENTICATED', context: {} }, 401));
    const response = await call;

    expect(ended).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    unsubscribe();
  });

  it('notifies for a 401 UNAUTHENTICATED whose request started under the current generation', async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    const ended = vi.fn();
    const unsubscribe = onSessionEnded(ended);
    bumpAuthGeneration();

    const call = apiFetch('/api/favorites');
    release(answer({ code: 'UNAUTHENTICATED', context: {} }, 401));
    await call;

    expect(ended).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('apiJson', () => {
  it('returns the parsed body of a success', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(answer({ url: 'https://pay.example' }));
    expect(await apiJson<{ url: string }>('/api/x')).toEqual({ url: 'https://pay.example' });
  });

  it('returns undefined for a 204', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await apiJson('/api/x', { method: 'DELETE' })).toBeUndefined();
  });

  it('throws the ApiError of a failure, with its code, context and status (AR-38)', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(answer({ code: 'PLAN_LIMIT_REACHED', context: { limit: 5 } }, 403));

    const error = await apiJson('/api/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'PLAN_LIMIT_REACHED', context: { limit: 5 }, status: 403 });
  });

  it('throws UNKNOWN for a failure that is not an API body', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response('<html>', { status: 500 }));
    await expect(apiJson('/api/x')).rejects.toMatchObject({ code: 'UNKNOWN', status: 500 });
  });
});
