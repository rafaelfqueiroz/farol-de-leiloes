import { ConfigService } from '@nestjs/config';
import { ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfigService } from '../config/env.js';

/**
 * SC-04: a coarse per-origin limit on the unauthenticated, email-sending routes (sign-up,
 * recovery request, reset, confirmation resend). It is a flood guard only; the precise
 * rules of BR-001-15 for sign-in are LoginAttemptsService's. Applied per route with
 * `@UseGuards(ThrottlerGuard)`, not globally, so /api/health and the rest are never throttled.
 * The origin is `req.ip`, the real client behind Caddy and behind the BFF (which forwards Caddy's
 * X-Forwarded-For) because of TRUST_PROXY_HOPS (app.setup.ts).
 */
export const AUTH_RATE_LIMIT = { limit: 20, ttl: 15 * 60 * 1000 } as const;

export function authThrottlerOptions(config: AppConfigService): ThrottlerModuleOptions {
  const isTest = config.get('NODE_ENV', { infer: true }) === 'test';
  return {
    throttlers: [{ name: 'default', ...AUTH_RATE_LIMIT }],
    // Specs sign up and reset from one loopback address, far past a real person's limit; the
    // limit has its own spec that runs with another NODE_ENV.
    skipIf: () => isTest,
  };
}

export const AuthThrottlerModule = ThrottlerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: authThrottlerOptions,
});
