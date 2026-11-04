// AR-47 / TS-07: Sentry is inert without a DSN and in tests, and scrubbed when it is on.
import { describe, expect, it } from 'vitest';
import { NO_PERSONAL_DATA, sentryOptions } from './sentry-options';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrubber';

const DSN = 'https://public-key@o0.ingest.example.test/1';

describe('sentryOptions (AR-47)', () => {
  it('is inert without an environment or a DSN', () => {
    expect(sentryOptions(undefined)).toBeUndefined();
    expect(sentryOptions({ NODE_ENV: 'production' })).toBeUndefined();
  });

  it('is inert in tests even with a DSN (TS-07)', () => {
    expect(sentryOptions({ NODE_ENV: 'test', SENTRY_DSN: DSN })).toBeUndefined();
  });

  it('collects no personal data, traces nothing and scrubs every event and breadcrumb', () => {
    const options = sentryOptions({ NODE_ENV: 'production', SENTRY_DSN: DSN });

    expect(options).toMatchObject({
      dsn: DSN,
      environment: 'production',
      dataCollection: NO_PERSONAL_DATA,
      includeLocalVariables: false,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
    expect(options).not.toHaveProperty('tracesSampleRate');
    expect(options).not.toHaveProperty('tracesSampler');
    expect(NO_PERSONAL_DATA).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
  });
});
