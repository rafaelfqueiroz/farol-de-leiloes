// AR-47: production without a DSN says so once, at boot.
import { describe, expect, it, vi } from 'vitest';
import { testConfigService } from '../../../test/support/test-env.js';
import { ObservabilityModule, warnWithoutSentry } from './observability.module.js';

const DSN = 'https://public-key@o0.ingest.example.test/1';

describe('warnWithoutSentry (AR-47)', () => {
  it('warns in production without a DSN', () => {
    const logger = { warn: vi.fn() };
    warnWithoutSentry(testConfigService({ NODE_ENV: 'production' }), logger);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain('SENTRY_DSN');
  });

  it.each([
    ['production with a DSN', { NODE_ENV: 'production', SENTRY_DSN: DSN }],
    ['development without one', { NODE_ENV: 'development' }],
  ])('stays quiet in %s', (_label, env) => {
    const logger = { warn: vi.fn() };
    warnWithoutSentry(testConfigService(env), logger);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('runs at application bootstrap', () => {
    const module = new ObservabilityModule(testConfigService({ NODE_ENV: 'production' }));
    const warn = vi.spyOn((module as unknown as { logger: { warn: () => void } }).logger, 'warn');
    module.onApplicationBootstrap();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
