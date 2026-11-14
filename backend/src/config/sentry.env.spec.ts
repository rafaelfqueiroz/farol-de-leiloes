// AR-47: the pre-boot read of NODE_ENV and SENTRY_DSN (config/sentry.env.ts).
import { describe, expect, it } from 'vitest';
import { parseSentryEnv, sentryEnvFromProcess } from './sentry.env.js';

const DSN = 'https://public-key@o0.ingest.example.test/1';

describe('parseSentryEnv', () => {
  it('reads the DSN and the environment', () => {
    expect(parseSentryEnv({ NODE_ENV: 'production', SENTRY_DSN: DSN })).toEqual({
      NODE_ENV: 'production',
      SENTRY_DSN: DSN,
    });
  });

  it('treats an empty value as unset and defaults NODE_ENV like the boot schema', () => {
    expect(parseSentryEnv({ NODE_ENV: '', SENTRY_DSN: '' })).toEqual({ NODE_ENV: 'development' });
  });

  it('never throws on an invalid value: Sentry stays inert and the boot validation refuses it', () => {
    expect(parseSentryEnv({ SENTRY_DSN: 'not-a-url' })).toBeUndefined();
    expect(parseSentryEnv({ NODE_ENV: 'staging' })).toBeUndefined();
  });

  it('reads the process environment', () => {
    expect(sentryEnvFromProcess()).toEqual(parseSentryEnv(process.env));
  });
});
