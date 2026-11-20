import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfigService } from '../config/env.js';

/**
 * SPEC-010 (SC-04): a per-ACCOUNT limit on the routes that write consent records (accepting a new
 * version, answering the WhatsApp request). They are cheap, but each call is a database write on
 * the account's own proof records, so a signed-in caller in a loop must not be able to fill them.
 * The key is the account, not the address. 30 a minute is far above a person's use.
 */
export const PRIVACY_RATE_LIMIT = { limit: 30, ttl: 60 * 1000 } as const;

export function privacyThrottlerOptions(config: AppConfigService): ThrottlerModuleOptions {
  const isTest = config.get('NODE_ENV', { infer: true }) === 'test';
  return {
    throttlers: [{ name: 'default', ...PRIVACY_RATE_LIMIT }],
    // Specs call the routes far past a person's rate; the limit has its own spec that runs with
    // another NODE_ENV.
    skipIf: () => isTest,
  };
}

export const PrivacyThrottlerModule = ThrottlerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: privacyThrottlerOptions,
});

/** The throttler keyed by the authenticated account (falling back to the address, never blank). */
@Injectable()
export class PrivacyAccountThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req['user'] as { userId?: unknown } | undefined;
    const ip = typeof req['ip'] === 'string' ? req['ip'] : 'unknown';
    return Promise.resolve(typeof user?.userId === 'string' ? `account:${user.userId}` : ip);
  }

  /** One counter per account across the privacy write routes (the default key adds the handler). */
  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return `privacy-${name}-${tracker}`;
  }
}
