import { ConfigService } from '@nestjs/config';
import { ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfigService } from '../../config/env.js';

/**
 * SPEC-004 BR-004-22 (SC-04, SC-18): a per-origin limit on the route that issues a link to a
 * matrícula copy: each call signs a URL for a private file, so even an admin in a loop must not
 * mint them without bound. Applied per route with `@UseGuards(ThrottlerGuard)`.
 */
export const MATRICULA_LINK_RATE_LIMIT = { limit: 20, ttl: 60 * 1000 } as const;

export function auctionDocumentsThrottlerOptions(config: AppConfigService): ThrottlerModuleOptions {
  const isTest = config.get('NODE_ENV', { infer: true }) === 'test';
  return {
    throttlers: [{ name: 'default', ...MATRICULA_LINK_RATE_LIMIT }],
    skipIf: () => isTest, // the limit has its own spec that runs with another NODE_ENV
  };
}

export const AuctionDocumentsThrottlerModule = ThrottlerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: auctionDocumentsThrottlerOptions,
});
