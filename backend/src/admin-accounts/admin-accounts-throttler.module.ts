import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfigService } from '../config/env.js';

/**
 * SPEC-009 BR-009-13 (SC-04): an account search scans the accounts (a contains-search has no index), so
 * one admin, or a stolen admin session, must not be able to run it in a loop. The limit is per ACCOUNT:
 * 30 searches a minute is far above what a person typing needs and keeps a script from enumerating.
 */
export const ACCOUNT_SEARCH_RATE_LIMIT = { limit: 30, ttl: 60 * 1000 } as const;

export function accountSearchThrottlerOptions(config: AppConfigService): ThrottlerModuleOptions {
  const isTest = config.get('NODE_ENV', { infer: true }) === 'test';
  return {
    throttlers: [{ name: 'default', ...ACCOUNT_SEARCH_RATE_LIMIT }],
    // Specs search far past a person's rate; the limit has its own specs, run with another NODE_ENV.
    skipIf: () => isTest,
  };
}

export const AdminAccountsThrottlerModule = ThrottlerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: accountSearchThrottlerOptions,
});

/** The throttler keyed by the authenticated admin account (falling back to the address, never blank). */
@Injectable()
export class AccountSearchThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req['user'] as { userId?: unknown } | undefined;
    const ip = typeof req['ip'] === 'string' ? req['ip'] : 'unknown';
    return Promise.resolve(typeof user?.userId === 'string' ? `account:${user.userId}` : ip);
  }

  /** One counter per account for the search (the default key adds the handler). */
  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return `account-search-${name}-${tracker}`;
  }
}
