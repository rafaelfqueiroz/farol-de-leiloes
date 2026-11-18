import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfigService } from '../config/env.js';

/**
 * SPEC-012 (SC-04): a per-ACCOUNT limit on the office billing routes. Every call on them can reach
 * the payment provider (a read lists invoices, an action changes a subscription), so a signed-in
 * caller in a loop would exhaust the provider's rate limit for everybody. The key is the account,
 * not the address: a member behind an office's shared address is not throttled by a colleague.
 */
export const BILLING_RATE_LIMIT = { limit: 60, ttl: 60 * 1000 } as const;

export function billingThrottlerOptions(config: AppConfigService): ThrottlerModuleOptions {
  const isTest = config.get('NODE_ENV', { infer: true }) === 'test';
  return {
    throttlers: [{ name: 'default', ...BILLING_RATE_LIMIT }],
    // Specs call the routes from one account far past a person's rate; the limit has its own spec
    // that runs with another NODE_ENV.
    skipIf: () => isTest,
  };
}

export const BillingThrottlerModule = ThrottlerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: billingThrottlerOptions,
});

/** The throttler keyed by the authenticated account (falling back to the address, never blank). */
@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req['user'] as { userId?: unknown } | undefined;
    const ip = typeof req['ip'] === 'string' ? req['ip'] : 'unknown';
    return Promise.resolve(typeof user?.userId === 'string' ? `account:${user.userId}` : ip);
  }

  /**
   * One counter per account across ALL the billing routes (the default key adds the controller and
   * the handler, which would give each route its own allowance).
   */
  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return `billing-${name}-${tracker}`;
  }
}
