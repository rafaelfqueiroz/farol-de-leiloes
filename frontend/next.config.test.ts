// @vitest-environment node
import { describe, expect, it } from 'vitest';
import config from './next.config';

describe('SC-17 Next response headers', () => {
  it('protects every route, including BFF and static responses', async () => {
    const routes = await config.headers?.();
    expect(routes).toHaveLength(1);
    expect(routes?.[0]?.source).toBe('/:path*');
    expect(routes?.[0]?.headers).toEqual(
      expect.arrayContaining([
        {
          key: 'Content-Security-Policy',
          value: expect.stringContaining("frame-ancestors 'none'"),
        },
        { key: 'Strict-Transport-Security', value: 'max-age=15552000' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ]),
    );
  });
});
