// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePublicEnv, parseServerEnv, publicEnvSchema, serverEnv, serverEnvSchema } from './env';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('SC-17 CSP enforcement mode', () => {
  it.each([
    ['production', 'Content-Security-Policy'],
    ['development', 'Content-Security-Policy-Report-Only'],
  ])('uses %s mode without relaxing script policy', async (mode, header) => {
    vi.stubEnv('NODE_ENV', mode);
    vi.resetModules();
    expect((await import('./env')).cspHeaderName).toBe(header);
  });
});

describe('parsePublicEnv', () => {
  it('SC-16: exposes only the approved public URLs and public Sentry DSN', () => {
    expect(Object.keys(publicEnvSchema.shape).sort()).toEqual([
      'NEXT_PUBLIC_AUCTIONS_API_URL',
      'NEXT_PUBLIC_SENTRY_DSN',
      'NEXT_PUBLIC_SITE_URL',
    ]);
    expect(parsePublicEnv({ NEXT_PUBLIC_JWT_SECRET: 'must-stay-private' })).not.toHaveProperty(
      'NEXT_PUBLIC_JWT_SECRET',
    );
  });

  it('falls back to the local defaults when nothing is set (CI builds with no environment)', () => {
    expect(parsePublicEnv({})).toEqual({
      apiUrl: 'http://localhost:3000',
      siteUrl: 'https://faroldosleiloes.com.br',
    });
  });

  it('treats an empty value like an unset one', () => {
    expect(parsePublicEnv({ NEXT_PUBLIC_AUCTIONS_API_URL: '' }).apiUrl).toBe(
      'http://localhost:3000',
    );
  });

  it('reads the configured values and drops trailing slashes', () => {
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_AUCTIONS_API_URL: 'https://api.example.com//',
        NEXT_PUBLIC_SITE_URL: 'https://example.com/',
      }),
    ).toEqual({ apiUrl: 'https://api.example.com', siteUrl: 'https://example.com' });
  });

  it('rejects a value that is not a URL', () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_AUCTIONS_API_URL: 'not a url' })).toThrow();
  });
});

describe('parseServerEnv', () => {
  it('uses BACKEND_API_URL when set', () => {
    expect(
      parseServerEnv({
        BACKEND_API_URL: 'http://backend:3000/',
        NEXT_PUBLIC_AUCTIONS_API_URL: 'https://api.example.com',
      }),
    ).toEqual({ backendUrl: 'http://backend:3000' });
  });

  it('falls back to the public backend URL, then to the local default', () => {
    expect(parseServerEnv({ NEXT_PUBLIC_AUCTIONS_API_URL: 'https://api.example.com' })).toEqual({
      backendUrl: 'https://api.example.com',
    });
    expect(parseServerEnv({})).toEqual({ backendUrl: 'http://localhost:3000' });
  });

  it('rejects a BACKEND_API_URL that is not a URL', () => {
    expect(() => parseServerEnv({ BACKEND_API_URL: 'nope' })).toThrow();
  });
});

describe('serverEnv', () => {
  it('reads process.env at call time', () => {
    vi.stubEnv('BACKEND_API_URL', 'http://backend:4000');
    expect(serverEnv().backendUrl).toBe('http://backend:4000');
    vi.stubEnv('BACKEND_API_URL', 'http://backend:5000');
    expect(serverEnv().backendUrl).toBe('http://backend:5000');
  });

  it('throws in the browser (AR-42)', () => {
    vi.stubGlobal('window', {});
    expect(() => serverEnv()).toThrow(/browser/);
  });
});

describe('schemas', () => {
  it('keep public variables under NEXT_PUBLIC_ and server variables outside it', () => {
    expect(Object.keys(publicEnvSchema.shape).every((k) => k.startsWith('NEXT_PUBLIC_'))).toBe(
      true,
    );
    expect(Object.keys(serverEnvSchema.shape).some((k) => k.startsWith('NEXT_PUBLIC_'))).toBe(
      false,
    );
  });
});
