import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfigService } from '../config/env.js';

/**
 * SPEC-009 (decision 6 of #9, SC-04): a support request sends two emails and stores free text, so an
 * account in a loop must not be able to turn it into a mail cannon or fill the collection. The limit is
 * per ACCOUNT, not per address: 5 requests an hour is far above any person's use and still lets a
 * second try follow a mistake.
 */
export const SUPPORT_RATE_LIMIT = { limit: 5, ttl: 60 * 60 * 1000 } as const;

export function supportThrottlerOptions(config: AppConfigService): ThrottlerModuleOptions {
  const isTest = config.get('NODE_ENV', { infer: true }) === 'test';
  return {
    throttlers: [{ name: 'default', ...SUPPORT_RATE_LIMIT }],
    // Specs call the route far past a person's rate; the limit has its own spec (and an integration
    // spec) that run with another NODE_ENV.
    skipIf: () => isTest,
  };
}

export const SupportThrottlerModule = ThrottlerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: supportThrottlerOptions,
});

/** The throttler keyed by the authenticated account (falling back to the address, never blank). */
@Injectable()
export class SupportAccountThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req['user'] as { userId?: unknown } | undefined;
    const ip = typeof req['ip'] === 'string' ? req['ip'] : 'unknown';
    return Promise.resolve(typeof user?.userId === 'string' ? `account:${user.userId}` : ip);
  }

  /** One counter per account for the support form (the default key adds the handler). */
  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return `support-${name}-${tracker}`;
  }
}
