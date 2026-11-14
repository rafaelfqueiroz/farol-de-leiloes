// AR-41: the environment is validated at boot. Missing secrets stop it, flags parse as written,
// tunables default, and the error names variables without ever echoing a value (SC-16).
import { describe, expect, it } from 'vitest';
import { TEST_ENV, testEnv } from '../../test/support/test-env';
import { validateEnv } from './env';
import { ENV_KEYS } from './env.schema';
import { r2ConfigFrom } from './r2.config';
import { schedulerConfigFrom } from './scheduler.config';
import { businessConfigFrom } from './business.config';

function errorOf(raw: Record<string, string | undefined>): string {
  try {
    validateEnv(raw);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected validateEnv to throw');
}

describe('validateEnv', () => {
  it('accepts the complete test environment', () => {
    expect(() => testEnv()).not.toThrow();
  });

  it.each(['JWT_SECRET', 'STRIPE_SECRET_KEY', 'SMTP_PASS', 'R2_SECRET_ACCESS_KEY', 'MONGODB_URI'])(
    'refuses to boot without %s, in every environment',
    (name) => {
      for (const NODE_ENV of ['development', 'test', 'production']) {
        expect(errorOf({ ...TEST_ENV, NODE_ENV, [name]: undefined })).toContain(`${name}: missing`);
      }
    },
  );

  it('treats an empty value as missing (`KEY=` in a .env file)', () => {
    expect(errorOf({ ...TEST_ENV, JWT_SECRET: '' })).toContain('JWT_SECRET: missing');
  });

  it('lists every problem at once, by name, and never a value', () => {
    const message = errorOf({
      ...TEST_ENV,
      JWT_SECRET: undefined,
      FRONTEND_URL: 'not-a-url-value',
      IMPORT_ENABLED: 'maybe-value',
      PORT: 'abc-value',
      STRIPE_SECRET_KEY: undefined,
    });

    for (const name of [
      'JWT_SECRET',
      'FRONTEND_URL',
      'IMPORT_ENABLED',
      'PORT',
      'STRIPE_SECRET_KEY',
    ]) {
      expect(message).toContain(`${name}:`);
    }
    for (const value of [
      ...Object.values(TEST_ENV),
      'not-a-url-value',
      'maybe-value',
      'abc-value',
    ]) {
      expect(message).not.toContain(value);
    }
  });

  it('reads "false" as false and "true" as true (z.stringbool, not z.coerce.boolean)', () => {
    const env = testEnv({
      IMPORT_ENABLED: 'false',
      CLEANUP_ON_STARTUP: 'true',
      SMTP_SECURE: 'false',
    });
    expect(env.IMPORT_ENABLED).toBe(false);
    expect(env.CLEANUP_ON_STARTUP).toBe(true);
    expect(env.SMTP_SECURE).toBe(false);
  });

  it('defaults the non-secret tunables', () => {
    const env = testEnv({ NODE_ENV: undefined });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      LLM_PROVIDER: 'ollama',
      OLLAMA_BASE_URL: 'http://localhost:11434/v1',
      IMPORT_ENABLED: true,
      IMPORT_ON_START_UP: false,
      SCRAPER_ENABLED: true,
      SCRAPER_ON_START_UP: false,
      REMINDERS_ENABLED: true,
      CLEANUP_ON_STARTUP: false,
      NEIGHBORHOODS_CACHE_ENABLED: false,
      NEIGHBORHOODS_CACHE_TTL: 600_000,
      SAVED_FILTERS_MAX_PER_USER: 10,
      UNAVAILABLE_AUCTION_RETENTION_DAYS: 14,
    });
  });

  describe('business settings (AR-43)', () => {
    it.each(['SAVED_FILTERS_MAX_PER_USER', 'UNAVAILABLE_AUCTION_RETENTION_DAYS'])(
      '%s is a positive integer',
      (key) => {
        expect(testEnv({ [key]: '25' })[key as 'SAVED_FILTERS_MAX_PER_USER']).toBe(25);
        for (const bad of ['0', '-1', '1.5', 'many']) {
          expect(errorOf({ ...TEST_ENV, [key]: bad })).toContain(`${key}:`);
        }
      },
    );

    it('treats an empty value as unset and takes the default', () => {
      expect(testEnv({ SAVED_FILTERS_MAX_PER_USER: '' }).SAVED_FILTERS_MAX_PER_USER).toBe(10);
    });
  });

  it.each([
    '*',
    'file:///tmp/app',
    'https://user:pass@example.test',
    'https://*.example.test',
    'https://example.test/path',
    'https://example.test?query=1',
    'https://example.test#fragment',
  ])(
    'SC-17: refuses a frontend URL that is not a single exact HTTP(S) origin: %s',
    (FRONTEND_URL) => expect(errorOf({ ...TEST_ENV, FRONTEND_URL })).toContain('FRONTEND_URL:'),
  );

  it.each([
    ['https://app.example.test/', 'https://app.example.test'],
    ['https://APP.example.test:443/', 'https://app.example.test'],
    ['http://localhost:3001/', 'http://localhost:3001'],
  ])('SC-17: normalizes FRONTEND_URL %s for every URL-building consumer', (input, origin) => {
    const config = testEnv({ FRONTEND_URL: input });
    expect(config.FRONTEND_URL).toBe(origin);
    for (const path of [
      '/auth/callback',
      '/verify-email/test-token',
      '/reset-password/test-token',
      '/plans/success',
      '/plans/cancel',
    ]) {
      expect(new URL(`${config.FRONTEND_URL}${path}`).pathname).toBe(path);
    }
  });

  it('coerces numbers', () => {
    expect(testEnv({ PORT: '8080', NEIGHBORHOODS_CACHE_TTL: '1000' })).toMatchObject({
      PORT: 8080,
      NEIGHBORHOODS_CACHE_TTL: 1000,
    });
  });

  describe('LLM keys', () => {
    it('needs no key for ollama, and leaves the other providers keys optional', () => {
      expect(testEnv({ LLM_PROVIDER: 'ollama' }).GROQ_API_KEY).toBeUndefined();
    });

    it.each([
      ['groq', 'GROQ_API_KEY'],
      ['gemini', 'GOOGLE_API_KEY'],
      ['openai', 'OPENAI_API_KEY'],
      ['anthropic', 'ANTHROPIC_API_KEY'],
    ])('requires the key of the selected provider (%s → %s)', (provider, key) => {
      expect(errorOf({ ...TEST_ENV, LLM_PROVIDER: provider })).toContain(
        `${key}: required when LLM_PROVIDER is ${provider}`,
      );
      expect(
        testEnv({ LLM_PROVIDER: provider, [key]: 'test-llm-key' })[key as 'GROQ_API_KEY'],
      ).toBe('test-llm-key');
    });

    it('reports the selected key together with the other problems', () => {
      const message = errorOf({ ...TEST_ENV, LLM_PROVIDER: 'groq', JWT_SECRET: undefined });
      expect(message).toContain('JWT_SECRET: missing');
      expect(message).toContain('GROQ_API_KEY: required when LLM_PROVIDER is groq');
    });

    it('refuses an unknown provider', () => {
      expect(errorOf({ ...TEST_ENV, LLM_PROVIDER: 'mystery' })).toContain('LLM_PROVIDER:');
    });
  });

  describe('observability (ARCHITECTURE §11)', () => {
    it('requires LOG_HASH_SECRET in production only (AR-41, AR-46)', () => {
      expect(
        errorOf({ ...TEST_ENV, NODE_ENV: 'production', LOG_HASH_SECRET: undefined }),
      ).toContain('LOG_HASH_SECRET: required when NODE_ENV is production');
      for (const NODE_ENV of ['development', 'test']) {
        expect(testEnv({ NODE_ENV, LOG_HASH_SECRET: undefined }).LOG_HASH_SECRET).toBeUndefined();
      }
    });

    it('refuses a LOG_HASH_SECRET shorter than 32 characters', () => {
      expect(errorOf({ ...TEST_ENV, LOG_HASH_SECRET: 'too-short-key' })).toContain(
        'LOG_HASH_SECRET:',
      );
      expect(testEnv({ LOG_HASH_SECRET: 'k'.repeat(32) }).LOG_HASH_SECRET).toBe('k'.repeat(32));
    });

    it('defaults LOG_LEVEL to info and refuses an unknown level', () => {
      expect(testEnv({ LOG_LEVEL: undefined }).LOG_LEVEL).toBe('info');
      expect(testEnv({ LOG_LEVEL: 'debug' }).LOG_LEVEL).toBe('debug');
      expect(errorOf({ ...TEST_ENV, LOG_LEVEL: 'verbose' })).toContain('LOG_LEVEL:');
    });

    it('keeps the test environment silent (TESTING §2)', () => {
      expect(testEnv().LOG_LEVEL).toBe('silent');
    });

    it('defaults TRUST_PROXY_HOPS to 0 and accepts only a non-negative integer (SC-04)', () => {
      expect(testEnv().TRUST_PROXY_HOPS).toBe(0);
      expect(testEnv({ TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
      expect(errorOf({ ...TEST_ENV, TRUST_PROXY_HOPS: '-1' })).toContain('TRUST_PROXY_HOPS:');
      expect(errorOf({ ...TEST_ENV, TRUST_PROXY_HOPS: '1.5' })).toContain('TRUST_PROXY_HOPS:');
    });

    it('leaves SENTRY_DSN optional, in production too, and refuses a malformed one', () => {
      expect(testEnv({ NODE_ENV: 'production' }).SENTRY_DSN).toBeUndefined();
      expect(testEnv({ SENTRY_DSN: 'https://key@o0.ingest.example.test/1' }).SENTRY_DSN).toBe(
        'https://key@o0.ingest.example.test/1',
      );
      expect(errorOf({ ...TEST_ENV, SENTRY_DSN: 'not-a-dsn' })).toContain('SENTRY_DSN:');
    });
  });

  it('describes every variable once', () => {
    expect(new Set(ENV_KEYS).size).toBe(ENV_KEYS.length);
  });
});

describe('namespaced configs built from the validated environment', () => {
  it('maps the scheduler flags and cache settings', () => {
    const config = schedulerConfigFrom(
      testEnv({
        IMPORT_ENABLED: 'false',
        SCRAPER_ON_START_UP: 'true',
        NEIGHBORHOODS_CACHE_TTL: '5',
      }),
    );
    expect(config).toEqual({
      import: { enabled: false, onStartup: false },
      scraper: { enabled: true, onStartup: true },
      cache: { neighborhoodsTtl: 5, neighborhoodsEnabled: false },
      reminders: { enabled: true },
      cleanup: { onStartup: false },
    });
  });

  it('maps the business settings (AR-43)', () => {
    expect(businessConfigFrom(testEnv())).toEqual({
      savedFilters: { maxPerUser: 10 },
      retention: { unavailableAuctionDays: 14 },
    });
    expect(
      businessConfigFrom(
        testEnv({ SAVED_FILTERS_MAX_PER_USER: '3', UNAVAILABLE_AUCTION_RETENTION_DAYS: '60' }),
      ),
    ).toEqual({ savedFilters: { maxPerUser: 3 }, retention: { unavailableAuctionDays: 60 } });
  });

  it('maps the R2 settings', () => {
    expect(r2ConfigFrom(testEnv())).toEqual({
      accountId: TEST_ENV.CLOUDFLARE_ACCOUNT_ID,
      accessKeyId: TEST_ENV.R2_ACCESS_KEY_ID,
      secretAccessKey: TEST_ENV.R2_SECRET_ACCESS_KEY,
      bucket: TEST_ENV.R2_BUCKET,
      publicUrl: TEST_ENV.R2_PUBLIC_URL,
    });
  });
});
