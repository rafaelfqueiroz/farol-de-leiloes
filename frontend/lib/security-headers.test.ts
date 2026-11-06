// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentSecurityPolicy } from './security-headers';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('SC-17 content security policy', () => {
  it('denies embedding, plugins, foreign base URLs and form submissions', () => {
    const directives = contentSecurityPolicy().split('; ');
    expect(directives).toContain("default-src 'self'");
    expect(directives).toContain("frame-ancestors 'none'");
    expect(directives).toContain("object-src 'none'");
    expect(directives).toContain("base-uri 'self'");
    expect(directives).toContain("form-action 'self'");
  });

  it('permits inline styles only as attributes used by MUI, and never inline scripts or eval', () => {
    const policy = contentSecurityPolicy('test-nonce');
    expect(policy.split('; ').filter((directive) => directive.includes('unsafe-'))).toEqual([
      "style-src-attr 'unsafe-inline'",
    ]);
    expect(policy).toContain("style-src 'self' 'nonce-test-nonce'");
    expect(policy).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic'");
  });

  it('keeps non-HTML responses restrictive without a reusable static nonce', () => {
    const policy = contentSecurityPolicy();
    expect(policy.split('; ')).toContain("script-src 'self'");
    expect(policy).not.toContain('nonce-');
    expect(
      policy.split('; ').find((directive) => directive.startsWith('connect-src')),
    ).not.toContain('*');
  });

  it('uses configured origins without exposing DSN credentials or paths across nonce changes', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUCTIONS_API_URL', 'https://api.example:444/');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public-key@sentry.example/42');
    vi.resetModules();
    const { contentSecurityPolicy: configuredPolicy } = await import('./security-headers');
    for (const nonce of ['first-nonce', 'second-nonce']) {
      const policy = configuredPolicy(nonce);
      expect(policy.split('; ')).toContain(
        "connect-src 'self' https://api.example:444 https://sentry.example",
      );
      expect(policy).not.toContain('public-key');
      expect(policy).not.toContain('/42');
    }
  });
});
