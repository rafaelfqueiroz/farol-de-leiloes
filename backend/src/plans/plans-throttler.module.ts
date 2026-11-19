import { ConfigService } from '@nestjs/config';
import { ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfigService } from '../config/env.js';

/**
 * SPEC-012 BR-012-05 (SC-04): a coarse per-origin limit on the public plans listing, a flood guard
 * only (the listing is cached for 30 s by every browser and proxy that honours `Cache-Control`).
 * The origin is `req.ip`, the real client behind Caddy and the BFF because of TRUST_PROXY_HOPS
 * (app.setup.ts). Applied per route with `@UseGuards(ThrottlerGuard)`, not globally.
 */
export const PLANS_RATE_LIMIT = { limit: 300, ttl: 60 * 1000 } as const;

export function plansThrottlerOptions(config: AppConfigService): ThrottlerModuleOptions {
  const isTest = config.get('NODE_ENV', { infer: true }) === 'test';
  return {
    throttlers: [{ name: 'default', ...PLANS_RATE_LIMIT }],
    // Specs call the listing from one loopback address; the limit has its own spec that runs with
    // another NODE_ENV.
    skipIf: () => isTest,
  };
}

export const PlansThrottlerModule = ThrottlerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: plansThrottlerOptions,
});
